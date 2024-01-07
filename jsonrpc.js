// wuilly
// 12/29/2023

/*
	reference: https://www.jsonrpc.org/specification
	
	note: while Scratch Link's network protocol doesn't make use of batches, i still feel like i should-
	implement them anyways just to follow along with the specification.
*/

const JSONRPC_VERSION = "2.0"

function is_number(what) {
	return !isNaN(Number(what))
}

class JSONRPC {
	constructor(ws) {
		this.ws = ws
	}

	send_notification(method, params) {
		if (this.ws == null) return
		this.ws.send(JSON.stringify({
			"jsonrpc": JSONRPC_VERSION,
			"method": method,
			"params": params
		}))
	}

	send_response(id, result, error) {
		if (this.ws == null) return
		let obj = {
			"jsonrpc": JSONRPC_VERSION,
			"result": result,
			"error": error,
			"id": id
		}

		if (result !== undefined) obj.result = result
		if (typeof error == "object" && is_number(error.code) && 
			typeof error.message == "string") obj.error = error

		this.ws.send(JSON.stringify(obj))
	}
}

export default JSONRPC