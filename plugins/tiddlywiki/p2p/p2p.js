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

if($tw.browser) {
	let bundle = require("$:/plugins/tiddlywiki/p2p/bundle");
	exports.adaptorClass = window.PeerToPeerAdaptor;
	console.log(window);
}

})();
