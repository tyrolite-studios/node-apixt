/**
 * Debug function which logs the given parameters on the console and returns the first param
 *
 * @param {mixed} main
 * @param {mixed} params
 *
 * @returns {mixed}
 */
function d(main, ...params) {
    let stack = []
    try {
        throw Error("foo")
    } catch (e) {
        stack = e.stack.split("\n")
    }
    const func = []
    let no = 0
    for (const line of stack) {
        const pos = no
        no++
        if (pos <= 1) continue

        if (pos === 2) {
            func.push(line.trim())
            continue
        }
        if (pos > 6) break

        const [first] = line.split("(")
        func.push(first.substring(6).trim())
    }
    console.group("Debug " + func.join(" <- "))
    console.log(main, ...params)
    console.groupEnd()

    return main
}

/**
 * Returns whether the given value is null or not
 *
 * @param {mixed} value
 *
 * @returns {boolean}
 */
const isNull = (value) => value === null

/**
 * Returns whether the given value is a string or not
 * Instances of the String class will not be regarded as strings.
 *
 * @param {mixed} value
 *
 * @returns {boolean}
 */
function isString(value) {
    return typeof value === "string"
}

/**
 * Returns whether the given value is an array or not
 *
 * @param {mixed} value
 *
 * @returns {boolean}
 */
function isArray(value) {
    return Array.isArray(value)
}

/**
 * Returns whether the argument is an object or not
 * Array instances are not regarded as objects
 *
 * @param {mixed} obj
 *
 * @returns {boolean}
 */
function isObject(obj) {
    return !!obj && typeof obj === "object" && !isArray(obj)
}

function isNumber(value) {
    return typeof value === "number" && !isNaN(value)
}

/**
 * Returns whether the given value is a function or not
 *
 * @param {mixed} value
 *
 * @returns {boolean}
 */
function isFunction(value) {
    return typeof value === "function"
}

function isInt(value) {
    return typeof value === "number" && Number.isInteger(value)
}

function isBool(value) {
    return typeof value === "boolean"
}

function cloneDeep(value) {
    if (value === undefined) return
    if (value === null) return null
    if (Array.isArray(value)) {
        return value.map((item) => cloneDeep(item))
    } else if (typeof value === "object") {
        const obj = {}
        for (let [key, subValue] of Object.entries(value)) {
            obj[key] = cloneDeep(subValue)
        }
        return obj
    }
    return value
}

export {
    d,
    isNull,
    isBool,
    isString,
    isNumber,
    isArray,
    isObject,
    isInt,
    cloneDeep
}
