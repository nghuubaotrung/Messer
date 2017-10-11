#!/usr/bin/env node

/* Imports */
const facebook = require("facebook-chat-api")
const repl = require("repl")

const helpers = require("./helpers.js")
const getCommandHandler = require("./command-handlers")
const eventHandlers = require("./event-handlers")
const log = require("./log")

/**
 * Messer creates a singleton that represents a Messer session 
 */
function Messer() {
  this.api = null
  this.user = null
  this.userCache = {} // cached by userID
  this.threadCache = {} // cached by id
  this.threadMap = {} // maps a thread/user name to a thread id
  this.threadStack = [] // array of ...
  this.lastThread = null
}

/**
 * Fetches and stores all relevant user details using a promise.
 */
Messer.prototype.fetchCurrentUser = function fetchCurrentUser() {
  const user = {}

  return new Promise((resolve, reject) => {
    user.userID = this.api.getCurrentUserID()

    this.api.getUserInfo(user.userID, (err, data) => {
      if (err) return reject(err)

      Object.assign(user, data[user.userID])

      return this.api.getFriendsList((err, data) => {
        if (err) return reject(err)

        data.forEach((u) => {
          this.threadMap[u.name || u.fullName] = u.userID
          this.userCache[u.userID] = u
        })

        this.api.getThreadList(0, 20, (err, threads) => {
          if (threads) {
            threads.forEach((t) => {
              this.cacheThread(t)
            })
          }

          return resolve(user)
        })
      })
    })
  })
}

/**
 * Authenticates a user with Facebook. Prompts for credentials if argument is undefined
 * @param {Object} credentials 
 */
Messer.prototype.authenticate = function authenticate(credentials) {
  log("Logging in...")
  return new Promise((resolve, reject) => {
    facebook(credentials, { forceLogin: true, logLevel: "silent" }, (err, fbApi) => {
      if (err) return reject(`Failed to login as [${credentials.email}] - ${err}`)

      helpers.saveAppState(fbApi.getAppState())

      this.api = fbApi

      log("Fetching your details...")

      return this.fetchCurrentUser()
        .then((user) => {
          this.user = user

          return resolve()
        })
        .catch(e => reject(e))
    })
  })
}

/**
 * Starts a Messer session
 */
Messer.prototype.start = function start() {
  helpers.getCredentials()
    .then(credentials => this.authenticate(credentials))
    .then(() => {
      log(`Successfully logged in as ${this.user.name}`)

      this.api.listen((err, ev) => {
        if (err) return null

        return eventHandlers[ev.type].call(this, ev)
      })

      repl.start({
        ignoreUndefined: true,
        eval: (input, context, filename, cb) => this.processCommand(input, cb),
      })
    })
    .catch(err => log(err))
}

/**
 * Execute appropriate action for user input commands
 * @param {String} rawCommand 
 * @param {Function} callback 
 */
Messer.prototype.processCommand = function processCommand(rawCommand, callback) {
  // ignore if rawCommand is only spaces
  if (rawCommand.trim().length === 0) return null

  const args = rawCommand.replace("\n", "").split(" ")
  const commandHandler = getCommandHandler(args[0])

  if (!commandHandler) {
    return log("Invalid command - check your syntax")
  }

  return commandHandler.call(this, rawCommand)
    .then((message) => {
      log(message)
      return callback(null)
    })
    .catch((err) => {
      log(err)
      return callback(null)
    })
}

/*
 * Adds a thread node to the thread cache
 */
Messer.prototype.cacheThread = function cacheThread(thread) {
  if (this.threadCache[thread.threadID]) return

  this.threadCache[thread.threadID] = {
    name: thread.name,
    threadID: thread.threadID,
  }
}

/*
 * Adds a thread node to the thread cache
 */
Messer.prototype.getThreadByName = function getThreadByName(name) {
  const threadName = Object.keys(this.threadMap)
    .find(n => n.toLowerCase().startsWith(name.toLowerCase()))

  const threadID = this.threadMap[threadName]

  if (this.threadCache[threadID].name.length === 0) {
    this.threadCache[threadID].name = threadName
  }

  return this.threadCache[threadID]
}

/*
 * Adds a thread node to the thread cache
 */
Messer.prototype.getThreadById = function getThreadById(threadID) {
  return new Promise((resolve, reject) => {
    let thread = this.threadCache[threadID]

    if (thread) return resolve(thread)

    return this.api.getThreadInfo(threadID, (err, data) => {
      if (err) return reject(err)

      thread = data
      this.cacheThread(thread)

      return resolve(thread)
    })
  })
}

// create new Messer instance
const messer = new Messer()
messer.start()
