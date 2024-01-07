/*
	wuilly - 12/29/2023

	description:
	a proof-of-concept that impersonates Scratch Link, written in JavaScript, and to be run with Node.js.
	this was mostly made for fun (:3), and to see if i could simulate an imaginary micro:bit peripheral.

	references:
	- https://github.com/scratchfoundation/scratch-vm/blob/develop/src/util/jsonrpc.js
	- https://github.com/scratchfoundation/scratch-vm/blob/develop/src/util/scratch-link-websocket.js
	- https://github.com/scratchfoundation/scratch-vm/blob/develop/src/extensions/scratch3_microbit/index.js
	- https://github.com/scratchfoundation/scratch-vm/blob/develop/src/extensions/scratch3_gdx_for/index.js
	- https://github.com/scratchfoundation/scratch-vm/blob/develop/src/io/ble.js
	- https://github.com/scratchfoundation/scratch-link/blob/develop/Documentation/BluetoothLE.md
	- https://github.com/scratchfoundation/scratch-link/blob/develop/Documentation/NetworkProtocol.md
	- https://github.com/scratchfoundation/scratch-link/blob/develop/scratch-link-common/BLE/BLESession.cs#L110
	- https://webbluetoothcg.github.io/web-bluetooth/#dom-requestdeviceoptions-filters
	- https://webbluetoothcg.github.io/web-bluetooth/#matches-a-filter
	- https://github.com/scratchfoundation/scratch-link/blob/develop/scratch-link-common/BLE/BLESession.cs#L454
*/

import JSONRPC from "./jsonrpc.js"
import {base64_to_uint8_array, uint8_array_to_base64} from "./util.js"
import {WebSocketServer} from "ws"

const NETWORK_PROTOCOL_VERSION = "1.3" // the current version number of Scratch Link's custom network protocol

const SERVER_PORT = 20111
const SOCKET_PATH_NAME = {
	BLE: "/scratch/ble",
	BT: "/scratch/bt"
}

const BLE_TIMEOUT_INTERVAL = 4500 // 4.5 seconds
const BLE_SEND_INTERVAL = 100 // 100ms seems to be the most commonly used interval for BLE peripherals
const BLE_COMMAND = {
    CMD_PIN_CONFIG: 0x80, // seemingly unused?
    CMD_DISPLAY_TEXT: 0x81,
    CMD_DISPLAY_LED: 0x82
}

const BLE_UUID = {
    SERVICE: 0xf005,
    RX_CHAR: "5261da01-fa7e-42ab-850b-7c80220097cc",
    TX_CHAR: "5261da02-fa7e-42ab-850b-7c80220097cc"
}

const BLE_COMMAND_ID = {
	DID_DISCOVER_PERIPHERAL: "didDiscoverPeripheral",
	CHARACTERISTIC_DID_CHANGE: "characteristicDidChange"
}

const BLE_METHOD = {
	GET_VERSION: "getVersion",
	DISCOVER: "discover",
	CONNECT: "connect",
	READ: "read",
	WRITE: "write",
	START_NOTIFICATIONS: "startNotifications",
	STOP_NOTIFICATIONS: "stopNotifications"
}

class Peripheral {
	constructor(type, id, name, rssi) {
		this._ble = null
		this._server = null
		this._fallback = []
		this._handlers = []
		this._notification_interval = null // should probably be an array instead?

		this.id = id || 0x0000
		this.name = name || "name"
		this.rssi = rssi || -70
		this.state = new Uint8Array(10) // pretend this is the peripheral state
		this.services = []

		type = type.toLowerCase()
		if (type !== "ble" && type !== "bt") {
			this.type = null
		} else {
			this.type = type || "ble"
		}
	}

	did_pass_filters(filters) {
		// this code is a tad bit ugly, but it works. should probably clean up later.
		let passed_filters = true
		filters.forEach(filter => {
			if (filter.name != null && filter.name !== this.name ||
				filter.namePrefix != null && !this.name.startsWith(filter.namePrefix)) {
				return passed_filters = false
			} else if (filter.services != null) {
				filter.services.forEach(service => {
					if (!this.services.includes(service)) {
						return passed_filters = false
					}
				})
			}
		})
		return passed_filters
	}

	decode_display_data(message) {
		let str = ""
		const command = message[0]
		switch (command) {
			case BLE_COMMAND.CMD_DISPLAY_TEXT:
				for (let i = 0; i < message.length-1; i++) {
					str += String.fromCharCode(message[1+i])
				}
				break
			case BLE_COMMAND.CMD_DISPLAY_LED:
				for (let i = 0; i < 5; i++) {
					str += message[1+i].toString(2).padStart(5, "0").replaceAll("0", ".") + "\n"
				}
				break
			default:
				console.warn("? unknown command given for display data, returning empty data")
				break
		}
		return str
	}

	register_handler(methods, func) {
		if (methods == null) this._fallback.push(func) // use as fallback instead
		if (!Array.isArray(methods)) methods = [methods]
		methods.forEach(method => {
			this._handlers[method] = this._handlers[method] || []
			this._handlers[method].push(func)
		})
	}

	run() {
		const pathname = this.type === "ble" && SOCKET_PATH_NAME.BLE || SOCKET_PATH_NAME.BT
		this.server = new WebSocketServer({
			"path": pathname,
			"port": SERVER_PORT
		}, () => {
			console.log("* server started")
		})

		this.server.on("connection", ws => {
			this._ble = new JSONRPC(ws)

			console.log("* client connected")
			ws.on("error", console.error)
					
			const fallback = this._fallback
			ws.on("message", data => {
				const json = JSON.parse(data)
				const method = json.method
				const params = json.params
				const id = json.id

				console.log(`<-- incoming "${method}" request`)
				const handlers = this._handlers[method]
				if (handlers == null) {
					console.warn(`? no handler for method "${method}", calling fallback handlers instead`)
				}

				// um
				(handlers || fallback).forEach(handler => {
					handler({
						"ble": this._ble,
						"method": method,
						"params": params,
						"id": id
					})
				})
			})

			ws.on("close", err => {
				console.log(`* client disconnected, ${err}`)
				if (this._notification_interval != null) {
					clearInterval(this._notification_interval)
				}

				if (err === 1005) {
					console.log("* disconnection was most likely intentional")
				} else {
					// (e.g. 1001)
					console.log("* disconnection might've been unintentional")
				}
			})
		})
	}
}

class MicroBit extends Peripheral {
	constructor(...args) {
		super(...args)
		this.services.push(BLE_UUID.SERVICE)

		this.register_handler(BLE_METHOD.GET_VERSION, ctx => {
			ctx.ble.send_response(id, {
				"protocol": NETWORK_PROTOCOL_VERSION
			})
		})

		this.register_handler(BLE_METHOD.DISCOVER, ctx => {
			// TODO: implement "manufacturerData" filter and check "optionalServices" array also
			const id = ctx.id
			const filters = ctx.params.filters
			if (this.did_pass_filters(filters)) {
				ctx.ble.send_response(id, null)
				console.log("--> outgoing response, successful")
							
				const notif = BLE_COMMAND_ID.DID_DISCOVER_PERIPHERAL
				ctx.ble.send_notification(notif, {
					"peripherialId": this.id,
					"name": this.name,
					"rssi": this.rssi
				})
				console.log(`--> outgoing "${notif}" notification`)
			} else {
				ctx.ble.send_response(id, undefined, {
					"code": -32000, // didn't pass filters
					"message": "failed to pass filters"
				})
				console.log("--> outgoing response, unsuccessful")
			}
		})

		this.register_handler(BLE_METHOD.CONNECT, ctx => {
			ctx.ble.send_response(ctx.id, null)
			console.log("--> outgoing response, successful")
		})

		this.register_handler([BLE_METHOD.READ, BLE_METHOD.WRITE], ctx => {
			const id = ctx.id
			const method = ctx.method
			const params = ctx.params
			const service_id = params.serviceId
			const characteristic_id = params.characteristicId
			const start_notifications = params.startNotifications

			let message = params.message
			const encoding = params.encoding
			if (encoding === "base64") {
				message = base64_to_uint8_array(message)
			}

			if (characteristic_id === BLE_UUID.RX_CHAR) {
				if (method == "read") {
					ctx.ble.send_response(id, null)
					console.log("--> outgoing response, successful")
				}
			} else if (characteristic_id === BLE_UUID.TX_CHAR) {
				if (method == "write") {
					ctx.ble.send_response(id, null)
					const str = this.decode_display_data(message)
					console.log("* display:")
					console.log(str)
					console.log("--> outgoing response, successful")
				}
			} else {
				console.log(characteristic_id, params)
			}

			if (start_notifications) {
				// satisfy some constant polling requirement required by certain peripherals
				const notif = BLE_COMMAND_ID.CHARACTERISTIC_DID_CHANGE
				this._notification_interval = setInterval(() => {
					ctx.ble.send_notification(notif, {
						"serviceId": service_id,
						"characteristicId": characteristic_id,
						"message": uint8_array_to_base64(this.state),
						"encoding": "base64"
					})
				}, BLE_SEND_INTERVAL)
				console.log(`--> outgoing "${notif}" notifications at ${BLE_SEND_INTERVAL}ms interval`)
			}
		})

		// TODO: figure out a nice way of handling these two requests...
		this.register_handler(BLE_METHOD.START_NOTIFICATIONS, ctx => {
			// https://github.com/scratchfoundation/scratch-vm/tree/develop/src/extensions/scratch3_gdx_for
			ctx.ble.send_response(ctx.id, null)
		})

		this.register_handler(BLE_METHOD.STOP_NOTIFICATIONS, ctx => {
			if (this._notification_interval != null) clearInterval(this._notification_interval)
			ctx.ble.send_response(ctx.id, null)
		})

		this.register_handler(null, ctx => {
			console.log(ctx)
		})
	}
}

const microbit = new MicroBit("ble", 0, "asdf", -70)
microbit.run()