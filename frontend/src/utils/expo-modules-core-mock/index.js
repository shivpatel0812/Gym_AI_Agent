function EventEmitter() {
  if (!(this instanceof EventEmitter)) {
    return new EventEmitter();
  }
  this._events = {};
}

EventEmitter.prototype.on = function(event, listener) {
  if (!this._events[event]) this._events[event] = [];
  this._events[event].push(listener);
  return this;
};

EventEmitter.prototype.off = function(event, listener) {
  return this.removeListener(event, listener);
};

EventEmitter.prototype.emit = function(event, ...args) {
  if (!this._events[event]) return false;
  this._events[event].forEach(listener => listener(...args));
  return true;
};

EventEmitter.prototype.once = function(event, listener) {
  const self = this;
  const onceWrapper = function(...args) {
    listener(...args);
    self.off(event, onceWrapper);
  };
  return this.on(event, onceWrapper);
};

EventEmitter.prototype.addListener = function(event, listener) {
  return this.on(event, listener);
};

EventEmitter.prototype.removeListener = function(event, listener) {
  if (!this._events[event]) return this;
  this._events[event] = this._events[event].filter(l => l !== listener);
  return this;
};

EventEmitter.prototype.removeAllListeners = function(event) {
  if (event) {
    delete this._events[event];
  } else {
    this._events = {};
  }
  return this;
};

EventEmitter.prototype.setMaxListeners = function(n) {
  return this;
};

EventEmitter.prototype.getMaxListeners = function() {
  return 10;
};

EventEmitter.prototype.listeners = function(event) {
  return this._events[event] || [];
};

EventEmitter.prototype.rawListeners = function(event) {
  return this._events[event] || [];
};

EventEmitter.prototype.listenerCount = function(event) {
  return (this._events[event] || []).length;
};

EventEmitter.prototype.prependListener = function(event, listener) {
  if (!this._events[event]) this._events[event] = [];
  this._events[event].unshift(listener);
  return this;
};

EventEmitter.prototype.prependOnceListener = function(event, listener) {
  const self = this;
  const onceWrapper = function(...args) {
    listener(...args);
    self.off(event, onceWrapper);
  };
  return this.prependListener(event, onceWrapper);
};

EventEmitter.prototype.eventNames = function() {
  return Object.keys(this._events);
};

const expoModulesCore = {
  registerWebModule: function() {},
  requireNativeModule: function() {
    return {};
  },
  NativeModulesProxy: {},
  Platform: {
    OS: 'web',
  },
  EventEmitter: EventEmitter,
};

expoModulesCore.EventEmitter = EventEmitter;
expoModulesCore.default = expoModulesCore;

module.exports = expoModulesCore;
