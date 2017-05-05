/*\
title: $:/plugins/tiddlywiki/p2p/p2p.js
type: application/javascript
module-type: syncadaptor

A p2p sync adaptor module

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

// Get a reference to the file system
var fs = $tw.node ? require("fs") : null,
	path = $tw.node ? require("path") : null;

function PeerToPeerAdaptor(options) {
	var self = this;
	this.wiki = options.wiki;
	this.logger = new $tw.utils.Logger("PeerToPeer");
}

PeerToPeerAdaptor.prototype.name = "p2p";

PeerToPeerAdaptor.prototype.isReady = function() {
	// The file system adaptor is always ready
	return true;
};

PeerToPeerAdaptor.prototype.getTiddlerInfo = function(tiddler) {
	return {};
};

/*
Get an array of skinny tiddler fields from the server
*/
PeerToPeerAdaptor.prototype.getSkinnyTiddlers = function(callback) {
	var self = this;
	callback("Err"]);
};

/*
Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
*/
PeerToPeerAdaptor.prototype.saveTiddler = function(tiddler,callback) {
	var self = this;
	var content = self.wiki.renderTiddler("text/plain","$:/core/templates/tid-tiddler",{variables: {currentTiddler: tiddler.fields.title}});
	self.logger.log("saveTiddler",tiddler, content);
	callback(null);
};

/*
Load a tiddler and invoke the callback with (err,tiddlerFields)

We don't need to implement loading for the file system adaptor, because all the tiddler files will have been loaded during the boot process.
*/
PeerToPeerAdaptor.prototype.loadTiddler = function(title,callback) {
	var self = this;
	self.logger.log("loadTiddler",title);
	callback(null,null);
};

/*
Delete a tiddler and invoke the callback with (err)
*/
PeerToPeerAdaptor.prototype.deleteTiddler = function(title,callback,options) {
	var self = this;
	self.logger.log("deleteTiddler",title);
	callback(null);
};

if(fs) {
	exports.adaptorClass = PeerToPeerAdaptor;
}

})();
