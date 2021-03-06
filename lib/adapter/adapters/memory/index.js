'use strict'

var applyUpdate = require('../../../common/apply_update')
var map = require('../../../common/array/map')

var constants = require('../../../common/constants')
var internalKey = constants.internal

var common = require('../common')
var applyOptions = common.applyOptions

var helpers = require('./helpers')
var inputRecord = helpers.inputRecord
var outputRecord = helpers.outputRecord


/**
 * Memory adapter.
 */
module.exports = function (Adapter) {
  function MemoryAdapter (properties) {
    Adapter.call(this, properties)
    if (!this.options) this.options = {}
    if (!('recordsPerType' in this.options))
      this.options.recordsPerType = 1000
  }

  Object.defineProperty(MemoryAdapter, internalKey, { value: true })

  MemoryAdapter.prototype = Object.create(Adapter.prototype)

  MemoryAdapter.prototype.connect = function () {
    var Promise = this.Promise
    var recordTypes = this.recordTypes
    var type

    this.db = {}

    for (type in recordTypes)
      this.db[type] = {}

    return Promise.resolve()
  }


  MemoryAdapter.prototype.disconnect = function () {
    var Promise = this.Promise
    delete this.db
    return Promise.resolve()
  }


  MemoryAdapter.prototype.find = function (type, ids, options, meta) {
    var self = this
    var Promise = self.Promise
    var db = self.db
    var recordTypes = self.recordTypes
    var fields = recordTypes[type]
    var collection = db[type]
    var records = []
    var i, j, id, record

    if (ids && !ids.length) return Adapter.prototype.find.call(self)

    if (ids) for (i = 0, j = ids.length; i < j; i++) {
      id = ids[i]
      if (id in collection) {
        record = collection[id]

        // LRU update.
        delete collection[id]
        collection[id] = record

        records.push(outputRecord.call(self, type, record))
      }
    }

    else for (id in collection)
      records.push(outputRecord.call(self, type, collection[id]))

    return Promise.resolve(applyOptions(fields, records, options, meta))
  }


  MemoryAdapter.prototype.create = function (type, records, meta) {
    var self = this
    var message = self.message
    var Promise = self.Promise
    var db = self.db
    var recordsPerType = self.options.recordsPerType
    var primaryKey = self.keys.primary
    var ConflictError = self.errors.ConflictError
    var collection = db[type]
    var i, j, record, id, ids, language

    if (!meta) meta = {}
    language = meta.language

    records = map(records, function (record) {
      return inputRecord.call(self, type, record)
    })

    // First check for collisions.
    for (i = 0, j = records.length; i < j; i++) {
      record = records[i]
      id = record[primaryKey]

      if (collection[id])
        return Promise.reject(new ConflictError(
          message('RecordExists', language, { id: id })))
    }

    // Then save it to memory.
    for (i = 0, j = records.length; i < j; i++) {
      record = records[i]
      collection[record[primaryKey]] = record
    }

    // Clear records.
    ids = Object.keys(collection)

    return (recordsPerType && ids.length > recordsPerType ?
      self.delete(type, ids.slice(0, ids.length - recordsPerType)) :
      Promise.resolve())

    .then(function () {
      return map(records, function (record) {
        return outputRecord.call(self, type, record)
      })
    })
  }


  MemoryAdapter.prototype.update = function (type, updates) {
    var self = this
    var Promise = self.Promise
    var db = self.db
    var primaryKey = self.keys.primary
    var collection = db[type]
    var count = 0
    var i, j, update, id, record

    if (!updates.length) return Adapter.prototype.update.call(self)

    for (i = 0, j = updates.length; i < j; i++) {
      update = updates[i]
      id = update[primaryKey]
      record = collection[id]

      if (!record) continue

      count++
      record = outputRecord.call(self, type, record)

      applyUpdate(record, update)

      // LRU update.
      delete collection[id]

      collection[id] = inputRecord.call(self, type, record)
    }

    return Promise.resolve(count)
  }


  MemoryAdapter.prototype.delete = function (type, ids) {
    var Promise = this.Promise
    var db = this.db
    var collection = db[type]
    var count = 0
    var i, j, id

    if (ids && !ids.length) return Adapter.prototype.delete.call(this)

    if (ids) for (i = 0, j = ids.length; i < j; i++) {
      id = ids[i]
      if (collection[id]) {
        delete collection[id]
        count++
      }
    }

    else for (id in collection) {
      delete collection[id]
      count++
    }

    return Promise.resolve(count)
  }

  return MemoryAdapter
}
