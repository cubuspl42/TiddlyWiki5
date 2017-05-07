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
	let peertopeeradaptor = require("./peertopeeradaptor");
	exports.adaptorClass = peertopeeradaptor.PeerToPeerAdaptor;
}

})();
