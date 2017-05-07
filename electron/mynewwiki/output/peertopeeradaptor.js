/*\
title: $:/plugins/tiddlywiki/p2p/peertopeeradaptor.js
type: application/javascript
module-type: syncadaptor

A p2p sync adaptor module

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

let Promise = require("bluebird");
let _ = require("underscore");
let WebTorrent = require('webtorrent');

// let _ = require("$:/plugins/tiddlywiki/p2p/underscore");
// let WebTorrent = require("$:/plugins/tiddlywiki/p2p/webtorrent");
let crypto = require('crypto');
let ed = require('ed25519-supercop');

if(Promise) {
	Promise.config({
		longStackTraces: true
	});
}

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
		.map((i) => JSON.parse(localStorage.getItem(localStorage.key(i))));
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


function noErrPromisifier(originalMethod) {
	return function promisified() {
		var args = [].slice.call(arguments); // might want to use smarter
		var self = this                      // promisification if performance critical
		return new Promise(function(resolve,reject) {
			args.push(resolve); 
			originalMethod.apply(self,args); // call with arguments
		});
	};
}

if(WebTorrent) {
	Promise.promisifyAll(LocalStorageAdaptor.prototype);
	Promise.promisifyAll(WebTorrent.prototype);
	WebTorrent.prototype.seedAsync = noErrPromisifier(WebTorrent.prototype.seed);	
}

let publicKey = '242246a854f990ee39cd1ec1be7e4d9a19e5e23351395e3f11948f4e6cc6d10a';
let privateKey = '48722d4fcef8c8d051d6a0397a088528719495db5a54e7f1f5c6ef6fe958a75e45172586a358b9267eacee243ec5fe4423cec56dd05ba54e73f6b7d58954b17b';
let publicKeyBuf = Buffer(publicKey, 'hex');
let privateKeyBuf = Buffer(privateKey, 'hex');
let targetId = crypto.createHash('sha1').update(publicKeyBuf).digest('hex');

function loadAllTiddlers() {
	return _.chain(_.range(localStorage.length))
		.map((i) => {
			let key = localStorage.key(i);
			return [key, JSON.parse(localStorage.getItem(key))];
		})
		.object()
		.value();
}

function getIndexMetadata(dht) {
	console.log('Getting DHT ready...');
	return dht.onAsync('ready')
		.then(() => dht.getAsync(targetId));
}

function extractJson(tiddlerTorrent) {
	return tiddlerTorrent.files[0].getBufferAsync()
		.then((tiddlerBuffer) => JSON.parse(tiddlerBuffer.toString('utf-8')));
}

function fetchIndex(indexInfoHash) {
	let torrentClient = webTorrentClient();

	console.log('Fetching index...');

	let indexTorrentPromise = torrentClient.addAsync(indexInfoHash);
	let donePromise = indexTorrentPromise.then(
		(indexTorrent) => indexTorrent.onAsync('done'));

	indexTorrentPromise.then(() => console.log('Added index torrent'));
	donePromise.then(() => console.log('Index downloaded'));

	return Promise
		.join(indexTorrentPromise, donePromise,
			(indexTorrent) => extractJson(indexTorrent))
		.finally(torrentClient.destroyAsync());
}

function webTorrentClient() {
	let client = WebTorrent({dht: {verify: ed.verify}});
	Promise.promisifyAll(client.dht);
	return client;
}

function PeerToPeerAdaptor(options) {
	console.log('> PeerToPeerAdaptor');
	var self = this;
	self.ready = false;
	self.wiki = options.wiki;
	self.logger = new $tw.utils.Logger("PeerToPeer");
	self.localStorageAdaptor = new LocalStorageAdaptor(options);
	self.indexTorrentClient = webTorrentClient();
	self.tiddlersTorrentClient = webTorrentClient();
	self.index = undefined;
	self.initIndex();
	console.log('< PeerToPeerAdaptor');
}

PeerToPeerAdaptor.prototype.name = "p2p";

PeerToPeerAdaptor.prototype.seedTiddler = function(tiddler) {
	let self = this;
	let buffer = Buffer(JSON.stringify(tiddler));
	return self.tiddlersTorrentClient.seedAsync(buffer, {name: 'tiddler'});
}

PeerToPeerAdaptor.prototype.initIndex = function() {
	let self = this;
	console.log("> initIndex");

	let tiddlers = loadAllTiddlers(); // {title: tiddler}

	return Promise
		.map(_.values(tiddlers), (tiddler) => self.seedTiddler(tiddler))
		.map((tiddlerTorrent) => tiddlerTorrent.infoHash)
		.then((tiddlerTorrentsInfoHashes) => {
			console.log("Updating index...");
			self.index = _.object(tiddlerTorrentsInfoHashes, _.keys(tiddlers));
		})
		.finally(() => console.log("< initIndex"));
};

PeerToPeerAdaptor.prototype.publishIndex = function() {
	var self = this;

	return Promise
		.try(() => console.log("> publishIndex"))
		.then(() => self.indexTorrentClient.destroyAsync())
		.then(() => {
			let indexJsonBuf = Buffer(JSON.stringify(self.index));
			self.indexTorrentClient = webTorrentClient();
			console.log("Seeding index...");
			return self.indexTorrentClient.seedAsync(indexJsonBuf, {name: 'index'});
		})
		.then((indexTorrent) => {
			var dhtClient = webTorrentClient();
			var dht = dhtClient.dht;
			Promise.promisifyAll(dht);

			return dht.onAsync('ready')
				.then(() => dht.getAsync(targetId))
				.then((res) => res ? res.seq : 0)
				.then((seq) => {
					console.log("Putting index torrent info hash into DHT...", seq);
					return dht.putAsync({
						k: publicKeyBuf,
						v: {indexInfoHash: Buffer(indexTorrent.infoHash, 'hex')},
						seq: seq + 1,
						sign: function (buf) {
							return ed.sign(buf, publicKeyBuf, privateKeyBuf)
						}
					});
				})
				.then(() => {
					console.log("DHT entry updated!");
				})
				.finally(() => dhtClient.destroyAsync())
				.finally(() => {
					console.log("< publishIndex");
				});
		});
};

PeerToPeerAdaptor.prototype.isReady = function() {
	var self = this;
	console.log('>< isReady', self.index !== undefined);
	return self.index !== undefined;
};

PeerToPeerAdaptor.prototype.getTiddlerInfo = function(tiddler) {
	var self = this;
	return self.localStorageAdaptor.getTiddlerInfo(tiddler);
};

/*
Get an array of skinny tiddler fields from the server
*/
PeerToPeerAdaptor.prototype.getSkinnyTiddlers = function(callback) {
	var self = this;
	console.log('> getSkinnyTiddlers', self.isReady());

	var dhtClient = webTorrentClient();
	var dht = dhtClient.dht;

	return getIndexMetadata(dht)
		.then((res) => {
			console.log('Received DHT entry:', res);
			if(!res) {
				console.log('DHT entry not found');
			} else if(res.seq > self.seq) {
				console.log('Index is out of date');
				self.seq = res.seq;
				return fetchIndex(res.indexInfoHash)
					.then((newIndex) => {
						console.log('Received new index:', newIndex);
						let indexDelta = _.pick(newIndex, (tiddlerInfoHash, tiddlerTitle) => {
							let oldTiddlerInfoHash = self.index[tiddlerTitle];
							return tiddlerInfoHash !== oldTiddlerInfoHash;
						});
						self.index = newIndex;
						let tiddlersInfoHashes = _.values(indexDelta);
						return tiddlersInfoHashes;
					})
					.map((tiddlerInfoHash) => self.client.addAsync(tiddlerInfoHash))
					.then((tiddlerTorrents) => {
						return Promise
							.map(tiddlerTorrents, (tiddlerTorrent) => tiddlerTorrent.onAsync('done'))
							.then(() => Promise.map(tiddlerTorrents, extractJson));
					})
					.map((tiddler) => self.localStorageAdaptor.saveTiddlerAsync(tiddler));
			} else {
				console.log('Index is up to date');
			}
		})
		.then(() => self.localStorageAdaptor.getSkinnyTiddlersAsync())
		.finally(() => dhtClient.destroyAsync())
		.finally(() => console.log('< getSkinnyTiddlers'))
		.asCallback(callback);
};

/*
Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
*/
PeerToPeerAdaptor.prototype.saveTiddler = function(tiddler,callback) {
	let self = this;
	let tiddlerTitle = tiddler.fields.title;

	Promise
		.try(() => console.log("> saveTiddler", tiddlerTitle))
		.then(() => self.localStorageAdaptor.saveTiddlerAsync(tiddler))
		.then(() => self.seedTiddler(tiddler))
		.then((tiddlerTorrent) => {
			self.index[tiddlerTitle] = tiddlerTorrent.infoHash;
		})
		.then(() => self.publishIndex())
		.finally(() => {
			for(let t of self.tiddlersTorrentClient.torrents) {
				console.log(t.infoHash);
			}
		})
		.finally(() => console.log("< saveTiddler", tiddlerTitle))
		.asCallback(callback);
};

/*
Load a tiddler and invoke the callback with (err,tiddlerFields)
*/
PeerToPeerAdaptor.prototype.loadTiddler = function(title,callback) {
	var self = this;
	self.localStorageAdaptor.loadTiddler(title, callback);
};

/*
Delete a tiddler and invoke the callback with (err)
*/
PeerToPeerAdaptor.prototype.deleteTiddler = function(title,callback,options) {
	var self = this;

	Promise.try(() => {
		console.log("> deleteTiddler", title);

		let tiddlerInfoHash = self.index[title];
		if(tiddlerInfoHash !== undefined) {
			console.log(tiddlerInfoHash);
			return self.tiddlersTorrentClient.removeAsync(tiddlerInfoHash)
				.then(() => delete self.index[title])
				.then(() => self.publishIndex())
				.then(() => Promise.fromCallback(
					(callback) => self.localStorageAdaptor.deleteTiddler(title, callback, options)
				))
				.catch((e) => {
					console.log(e);
					// console.log(self.tiddlersTorrentClient.)
					console.log(self.index);
				});
		}
	})
	.finally(() => {
		console.log("< deleteTiddler", title);
	})
	.asCallback(callback);
};

if($tw.browser) {
	exports.PeerToPeerAdaptor = PeerToPeerAdaptor;
}

})();
