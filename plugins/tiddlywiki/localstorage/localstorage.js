/*\
title: $:/plugins/tiddlywiki/localstorage/localstorage.js
type: application/javascript
module-type: syncadaptor

A Locale Storage sync adaptor module

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

let _ = $tw.node ?
	require("underscore") :
	require("$:/plugins/tiddlywiki/underscore/underscore.js");

function LocalStorageAdaptor(options) {
	let self = this;
	self.wiki = options.wiki;
	self.logger = new $tw.utils.Logger("LocalStorage");
}

LocalStorageAdaptor.prototype.name = "localstorage";

LocalStorageAdaptor.prototype.isReady = function() {
	let self = this;
	return true;
};

LocalStorageAdaptor.prototype.getTiddlerInfo = function(tiddler) {
	let self = this;
	return {};
};

/*
Get an array of skinny tiddler fields from the server
*/
LocalStorageAdaptor.prototype.getSkinnyTiddlers = function(callback) {
	let self = this;
	let tiddlers = _(_.range(localStorage.length))
		.map((i) => JSON.parse(localStorage.getItem(localStorage.key(i))))
		.map((tiddler) => tiddler.fields);
	console.log("getSkinnyTiddlers", tiddlers);
	callback(null, tiddlers);
};

/*
Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
*/
LocalStorageAdaptor.prototype.saveTiddler = function(tiddler,callback) {
	let self = this;
	let tiddlerTitle = tiddler.fields.title;
	let data = _.mapObject(tiddler.fields, (value, key) => tiddler.getFieldString(key));
	console.log("saveTiddler", data);
	localStorage.setItem(tiddlerTitle, JSON.stringify(data));
	callback(null);
};

/*
Load a tiddler and invoke the callback with (err,tiddlerFields)
*/
LocalStorageAdaptor.prototype.loadTiddler = function(title,callback) {
	let self = this;
	console.log("loadTiddler", title);
	let tiddler = JSON.parse(localStorage.getItem(title));
	callback(null, tiddler);
};

/*
Delete a tiddler and invoke the callback with (err)
*/
LocalStorageAdaptor.prototype.deleteTiddler = function(title,callback,options) {
	let self = this;
	console.log("deleteTiddler", title);
	localStorage.removeItem(title);
	callback(null);
};

if($tw.browser) {
	exports.adaptorClass = LocalStorageAdaptor;
}

})();
