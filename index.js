import path from "node:path"
import fs from "node:fs"
import { isBool, isInt, isArray, isString, d } from "./helper.js"
import { SignJWT, jwtVerify } from "jose"
import os from "node:os"

const __dirname = import.meta.dirname

const env = process.env

const configOptions = {
    apiId: { type: "string", public: true, required: true },
    baseUrl: { type: "string", public: true, required: true },
    dumpPath: { type: "string", public: true, required: true },

    permanent: { type: "bool", public: true, default: true },
    routes: { type: "array", public: true, default: [] },
    dumpHeader: { type: "string", public: true, default: "Tls-Apixt-Dump" },
    storePrefix: { type: "string", public: true, default: "tls.apixt." },
    enabled: { type: "bool", env: "ENABLED", default: true },
    jwtSecret: {
        type: "string",
        required: true,
        env: "JWT_SECRET"
    },
    users: {
        type: "array",
        default:
            env.APIXT_ENV_USERNAME && env.APIXT_ENV_PASSWORD
                ? [
                      {
                          name: env.APIXT_ENV_USERNAME,
                          password: env.APIXT_ENV_PASSWORD
                      }
                  ]
                : []
    }
}

const type2validator = {
    string: isString,
    bool: isBool,
    array: isArray,
    int: isInt
}

let secretKey
let config

async function createToken(username) {
    return await new SignJWT({ username })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("2h")
        .sign(secretKey)
}

async function getUsernameFromToken(jwt) {
    try {
        const { payload } = await jwtVerify(jwt, secretKey)
        return payload.username ?? "unknown"
    } catch (e) {}
    return
}

function parseCookies(req) {
    const list = {}
    const cookieHeader = req.headers.cookie

    if (cookieHeader) {
        cookieHeader.split(";").forEach((cookie) => {
            let [name, ...rest] = cookie.split("=")
            name = name.trim()
            const value = rest.join("=").trim()
            if (value) {
                list[name] = decodeURIComponent(value)
            }
        })
    }
    return list
}

class Timer {
    constructor() {
        this.running = 1
        this.total = 0
        this.started = performance.now()
        this.runs = 1
    }

    start() {
        this.running++
        this.runs++
        if (this.started == 0) {
            this.started = performance.now()
        }
        return this.runs
    }

    stop() {
        if (!this.running) return

        this.running--
        if (this.running > 0) return

        this.total += performance.now() - this.started
        this.started = 0
    }

    end() {
        if (this.started > 0) {
            this.total += performance.now() - this.started
        }
        return this.total
    }
}

const Block = (tree, name, data, closed) => {
    const index = tree.getCmdSlot()
    const obj = {
        cmd: closed || tree.closed ? undefined : 6,
        name,
        hash: name,
        ...data
    }
    tree.cmds[index] = obj
    return {
        index,
        footer: (value) => {
            obj.footer = value
        },
        isError: (value) => {
            obj.isError = value === true
        }
    }
}

const Section = (tree, name, parentClosed) => {
    const index = tree.getCmdSlot()

    const children = []
    tree.cmds[index] = { cmd: parentClosed ? undefined : 1, name }
    let details = false
    let closed = tree.closed

    const sec = {
        index,
        closed,
        addSection: (newName) => {
            const newSection = Section(tree, newName, closed)
            children.push(newSection.index)
            return newSection
        },
        openDetails: () => {
            const index = tree.getCmdSlot()
            details = true
            tree.cmds[index] = { cmd: closed ? undefined : 3 }
            children.push(index)
        },
        closeDetails: () => {
            const index = tree.getCmdSlot()
            if (!details) {
                throw Error(
                    `Cannot close details in section "${name}" because no details were opened before`
                )
            }
            tree.cmds[index] = { cmd: 4 }
            details = false
            children.push(index)
        },
        addBlock: (name, data) => {
            const newBlock = Block(tree, name, data, closed)
            children.push(newBlock.index)
            tree.checkHalt(name)
            return newBlock
        },
        close: () => {
            if (details) sec.closeDetails()
            const closeIndex = tree.getCmdSlot()

            tree.cmds[closeIndex] = { cmd: 2 }
            closed = true
            children.push(closeIndex)
            children.sort(), (tree.index2children[index] = children)
        },
        startTimer: (...args) => tree.startTimer(...args),
        stopTimer: (...args) => tree.stopTimer(...args)
    }
    tree.name2section.set(name, sec)

    return sec
}

class Tree {
    constructor(res) {
        this.closed = false
        this.level = 0
        this.cmds = []
        this.timers = {}
        this.index2children = {}
        this.halt = null
        this.name2section = new Map()
        this.startTimer("total")
        this.res = null
    }

    setHalt(req, res) {
        this.res = res

        let hash = req.header("Tls-Apixt-Halt")
        if (!hash) return

        let next = 0
        if (hash.startsWith(STOP_NEXT_PREFIX)) {
            hash = hash.substring(STOP_NEXT_PREFIX.length)
            next = 1
        }
        this.halt = { hash, next }
    }

    checkHalt(hash) {
        const halt = this.halt
        if (!halt) return

        let doPanic = halt.next === 2
        if (!doPanic && hash && halt.hash === hash) {
            if (halt.next === 0) {
                doPanic = true
            } else {
                halt.next++
            }
        }

        if (doPanic) {
            halt.stoppedAtHash = hash
            this.closeAll()
            this.abort()
            this.end()
            this.res.end()
        }
    }

    abort() {
        const index = this.getCmdSlot()
        const nextHash = STOP_NEXT_PREFIX + this.halt.stoppedAtHash
        this.cmds[index] = {
            cmd: 7,
            status: `Haltet at ${this.halt.stoppedAtHash}`,
            next: nextHash
        }
    }

    closeAll() {
        this.closed = true
        for (const section of this.name2section.values()) {
            section.close()
        }
    }
    addSection(name) {
        return Section(this, name, this.closed)
    }

    addBlock(name, data) {
        return Block(this, name, data, this.closed)
    }

    getCmdSlot() {
        const obj = {}
        this.cmds.push(obj)
        let i = this.cmds.length - 1
        while (this.cmds[i] !== obj) i--

        return i
    }

    d(main, ...params) {
        const index = this.getCmdSlot()
        if (index === null) return

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
        const name = "d() " + func.join(" <- ")

        const vars = []
        for (const item of [main, ...params]) {
            vars.push({ name: typeof item, value: item })
        }

        this.cmds[index] = { cmd: 5, name, vars }

        return main
    }

    startTimer(name) {
        const timer = this.timers[name]
        if (timer) {
            timer.start()
            return
        }
        this.timers[name] = new Timer()
    }

    stopTimer(name) {
        const timer = this.timers[name]
        if (!timer)
            throw Error(
                `Cannot execute stopTimer(). No timer with name "${name}" found!`
            )

        timer.stop()
    }

    getTimerResults() {
        const results = []
        const timers = [...Object.entries(this.timers)]
        while (timers.length) {
            const [name, timer] = timers.pop()
            results.push({ name, duration: timer.end(), runs: timer.runs })
        }
        return JSON.stringify(results)
    }

    end() {
        const index = this.getCmdSlot()

        this.closed = true
        this.cmds[index] = { cmd: 0 }
    }

    get body() {
        let body = ""

        const stringifyTree = (index) => {
            const node = this.cmds[index]

            if (node.cmd === undefined) return

            body += JSON.stringify(node) + "\n"
            this.cmds[index] = {}
            const rawChildren = this.index2children[index]
            if (!rawChildren) return

            const children = [...rawChildren]
            children.sort((a, b) => (a === b ? 0 : a < b ? -1 : 1))
            for (const child of children) {
                stringifyTree(child)
            }
        }

        let index = -1
        for (const item of this.cmds) {
            index++
            if (item.cmd === undefined) continue

            stringifyTree(index)
        }

        return body
    }
}

const STOP_NEXT_PREFIX = "-"

const packageJsonPath = path.resolve(__dirname, "package.json")
const packageJsonContent = fs.readFileSync(packageJsonPath, "utf-8")
const packageJson = JSON.parse(packageJsonContent)

const hostingApi = {
    language: { name: "nodejs", version: process.versions.node },
    apixt: {
        name: packageJson.name,
        version: packageJson.version,
        link: packageJson.repository.url
    },
    platform: {
        name: os.platform(),
        version: os.release(),
        build: os.version()
    }
}

const apixtDist = process.env.APIXT_DIST ? process.env.APIXT_DIST : "web"

let indexJs = ""
let indexCss = ""
let apixtJs = ""
try {
    const indexJsPath = path.resolve(__dirname, apixtDist, "index.js")
    indexJs = fs.readFileSync(indexJsPath, "utf8")
    const indexCssPath = path.resolve(__dirname, apixtDist, "index.css")
    indexCss = fs.readFileSync(indexCssPath, "utf8")
    const apixtJsPath = path.resolve(__dirname, apixtDist, "apixt.js")
    apixtJs = fs.readFileSync(apixtJsPath, "utf8")
} catch (err) {
    console.error(err)
}

let routes = []

const getResolvedOptionValue = (option, value) => {
    if (!option.env) return value

    const envName = "APIXT_" + option.env
    const envValue = env[envName]
    if (envValue) {
        switch (option.type) {
            case "bool":
                return ["1", "true", "on"].includes(envValue.toLowerCase())

            case "string":
                return envValue

            default:
                throw Error(
                    `Unsupported option type ${option.type} for environment variable ${envName}!`
                )
        }
    }
    return value
}

let enabled = true

const apixt = {
    get active() {
        return enabled
    },
    init: (rawConfig) => {
        config = {}
        for (const [key, option] of Object.entries(configOptions)) {
            const value = rawConfig[key]

            const validator = type2validator[option.type]
            if (!validator)
                throw Error(
                    `Invalid type "${option.type}" given for option "${key}"`
                )

            let resolved = getResolvedOptionValue(option, value)
            if (resolved === undefined) {
                if (option.required && option.default === undefined)
                    throw Error(
                        `Missing required value for config key "${key}"`
                    )

                resolved = option.default
            }

            if (!validator(resolved)) {
                throw Error(
                    `Expected value of option "${key}" to be "${option.type}" but got ${typeof resolved}`
                )
            }
            config[key] = resolved
        }
        secretKey = new TextEncoder().encode(config.jwtSecret)
        enabled = config.enabled
    },
    checkRequest: (req) => {
        const dumpHeader = req.header(config.dumpHeader)
        if (!dumpHeader) return false

        return true
    },
    handleIndex: (req, res) => {
        const title = `${apixt.config.apiId} - API Extender`
        res.send(`<html>
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
        ${indexCss}
    </style>
    <script type="text/javascript">
        ${indexJs}
    </script>
    <script type="text/javascript">
        window.controller.startApp("login", ${JSON.stringify(apixt.bootConfig)})
    </script>
</head>
    
<body>
</body>
</html>`)
    },
    handleRefresh: async (req, res) => {
        const headerValue = req.header("Authorization")
        if (headerValue) {
            const parts = headerValue.split(" ")
            if (parts.length == 2 || parts[0] === "Bearer") {
                const username = await getUsernameFromToken(parts[1])
                if (username) {
                    await apixt.sendAuthorized(res, username)
                    return
                }
            }
        }
        res.status(401)
        res.send()
    },
    sendAuthorized: async (res, username) => {
        const tokenString = await createToken(username)
        res.json({
            config: { ...apixt.apixtConfig, username },
            jwt: tokenString
        })
    },
    handleLogin: async (req, res) => {
        const { username, password } = req.body

        for (const user of config.users) {
            if (username !== user.name) continue
            if (password !== user.password) break
            await apixt.sendAuthorized(res, username)
            return
        }
        res.status(401)
        res.send()
    },
    handleDumpJs: async (req, res) => {
        const cookies = parseCookies(req)
        const jwt = cookies[apixt.jwtCookieKey]
        if (!jwt) {
            res.status(401)
            res.send()
            return
        }
        const username = await getUsernameFromToken(jwt)
        if (!username) {
            res.status(401)
            res.send()
            return
        }
        res.set("Content-Type", "text/javascript")
        res.send(
            apixtJs +
                `; controller.startApp('apixt', ${JSON.stringify({ ...apixt.apixtConfig, username })})`
        )
    },
    addRoute(path, methods) {
        routes.push({ path, methods: isArray(methods) ? methods : [methods] })
    },
    dumpHttpResponse(res, buffer) {
        const { xt } = res

        if (!xt) return

        const sec = xt.addSection("API Response")

        const statusCode = res.statusCode
        const headers = res.getHeaders()
        const headerLines = []
        for (const [name, value] of Object.entries(headers)) {
            headerLines.push(`${name}: ${value}`)
        }
        sec.openDetails()
        sec.addBlock("Headers", {
            mime: "text/plain",
            content: headerLines.join("\n")
        })
        sec.closeDetails()

        const footer = {}
        const contentParts = headers["content-type"].split(";")
        footer["Status"] = statusCode
        footer["Content-Type"] = contentParts.join(";")

        sec.addBlock("Body", {
            footer,
            mime: contentParts[0],
            content: buffer,
            tags: ["api.response"],
            isError: statusCode < 200 || statusCode >= 400
        })
        sec.close()
    },
    dumpTimers(res) {
        const { xt } = res
        if (!xt) return

        xt.addBlock("Execution Times", {
            mime: "text/json",
            content: xt.getTimerResults()
        })
    },
    handleErrors(err, req, res, next) {
        next(err)
    },
    bindTo(...objects) {
        const xt = new Tree()
        for (const obj of objects) {
            obj.xt = xt
            obj.d = xt.d.bind(xt)
        }
        return xt
    },
    get jwtCookieKey() {
        const { storePrefix, apiId } = config
        return storePrefix + apiId + ".jwt"
    },
    get config() {
        return config
    },
    get apixtConfig() {
        const apixtConfig = {}
        for (const [key, option] of Object.entries(configOptions)) {
            if (!option.public) continue
            apixtConfig[key] = config[key]
        }
        apixtConfig.routes = routes
        return {
            ...apixtConfig,
            hostingApi
        }
    },
    get bootConfig() {
        const { apiId, permanent, storePrefix } = config

        return {
            apiId,
            permanent,
            jwtCookieKey: apixt.jwtCookieKey,
            storePrefix,
            apiId
        }
    }
}

export default apixt
