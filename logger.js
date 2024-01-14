// wuilly
// 1/14/2024

class Logger {
	constructor(silent) {
		this.silent = silent || false
	}

	log(...args) {
		if (this.silent || !Array.isArray(args) || args.length == 0) return
		args[0] = args[0]
		console.log(...args)
	}

	warn(...args) {
		if (this.silent || !Array.isArray(args) || args.length == 0) return
		args[0] = args[0]
		console.warn(...args)
	}

	error(...args) {
		if (this.silent || !Array.isArray(args) || args.length == 0) return
		args[0] = args[0]
		console.error(...args)
	}
}

export default Logger