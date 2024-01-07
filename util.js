// wuilly
// 12/29/2023

// reference: https://github.com/scratchfoundation/scratch-vm/blob/develop/src/util/base64-util.js

export function base64_to_uint8_array(str) {
	const split = atob(str).split("")
	let array = new Uint8Array(split.length)
	for (const idx in split) {
		array[idx] = split[idx].charCodeAt(0)
	}
	return array
}

export function uint8_array_to_base64(array) {
	return btoa(String.fromCharCode.apply(null, array))
}