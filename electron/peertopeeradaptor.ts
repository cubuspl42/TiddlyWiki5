/*\
title: $:/plugins/tiddlywiki/p2p/peertopeeradaptor.js
type: application/javascript
module-type: syncadaptor

A p2p sync adaptor module

\*/

import * as Bluebird from "bluebird";
import { TimeoutError } from "bluebird";
import * as _ from "underscore";
import * as WebTorrent from "webtorrent";
import * as DHT from "bittorrent-dht";
import { Torrent } from "webtorrent";
import { WebTorrentAsync, TorrentAsync, async } from "./webtorrent-async";
import { Mutex } from "async-mutex";

import crypto = require("crypto");
import ed = require("ed25519-supercop");

import "./webtorrent-async";

declare const $tw: any;

Bluebird.config({
	longStackTraces: true
});

function extractFields(tiddler) {
	let data = _.mapObject(tiddler.fields,
		(value, key) => tiddler.getFieldString(key));
	return data;
}

function saveTiddlerFields(tiddlerFields) {
	let tiddlerTitle = tiddlerFields.title;
	localStorage.setItem(tiddlerTitle, JSON.stringify(tiddlerFields));
}

class LocalStorageAdaptor {

	wiki: any;
	logger: any;

	constructor(options) {
		this.wiki = options.wiki;
		this.logger = new $tw.utils.Logger("LocalStorage");
	}

	name = "localstorage";

	isReady() {
		return true;
	};

	getTiddlerInfo(tiddler) {
		return {};
	};

	/*
	Get an array of skinny tiddler fields from the server
	*/
	getSkinnyTiddlers(callback) {
		let tiddlers = _(_.range(localStorage.length))
			.map((i) => JSON.parse(localStorage.getItem(localStorage.key(i))));
		console.log("getSkinnyTiddlers", tiddlers);
		callback(null, tiddlers);
	};

	getSkinnyTiddlersAsync: () => Bluebird<any[]>
	= Bluebird.promisify(this.getSkinnyTiddlers as (cb: (err: any, res: any[]) => void) => void);

	/*
	Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
	*/
	saveTiddler(tiddler, callback) {
		saveTiddlerFields(extractFields(tiddler));
		callback(null);
	};

	saveTiddlerAsync: (tiddler: any) => Bluebird<void>
	= Bluebird.promisify(this.saveTiddler as (tiddler: any, cb: (err: any, res: void) => void) => void);

	/*
	Load a tiddler and invoke the callback with (err,tiddlerFields)
	*/
	loadTiddler(title, callback) {
		// console.log("loadTiddler", title);
		let tiddler = JSON.parse(localStorage.getItem(title));
		callback(null, tiddler);
	};

	loadTiddlerAsync: (title: string) => Bluebird<any>
	= Bluebird.promisify(this.loadTiddler as (title: string, cb: (err: any, res: any) => void) => void);

	/*
	Delete a tiddler and invoke the callback with (err)
	*/
	deleteTiddler(title, callback, options) {
		console.log("deleteTiddler", title);
		localStorage.removeItem(title);
		callback(null);
	};

	deleteTiddlerAsync: (title: string) => Bluebird<void>
	= Bluebird.promisify(this.deleteTiddler as (title: string, cb: (err: any, res: void) => void) => void);
}

let keypair = require('./keypair.json')
let publicKey = keypair.publicKey;
let privateKey = keypair.secretKey;
let publicKeyBuf = new Buffer(publicKey, 'hex');
let privateKeyBuf = new Buffer(privateKey, 'hex');
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
	// console.log('Bootstraping DHT...');
	return Bluebird
		.try(() => dht.getAsync(targetId))
		.then((res) => {
			console.log('Received DHT entry:', res);
			if (res) {
				console.log('Seq:', res.seq);
				console.log('Index info hash:', res.v.indexInfoHash.toString('hex'));
			}
			return res;
		});
}

async function putIndexMetadata(dht, data, cas, seq) {
	console.log('Putting data into DHT...', {
		cas: cas,
		seq: seq
	});
	await dht.putAsync({
		k: publicKeyBuf,
		v: data,
		cas: cas,
		seq: seq,
		sign: function (buf) {
			return ed.sign(buf, publicKeyBuf, privateKeyBuf)
		}
	}).catch((e) => {
		console.warn(e);
	});
}

async function extractJson(torrent: Torrent): Promise<any> {
	let buffer = await async(torrent.files[0]).getBufferAsync();
	return JSON.parse(buffer.toString('utf-8'));
}

async function fetchTorrent(torrentClient: WebTorrent.Instance, magnetURI: string): Promise<Torrent> {
	return new Bluebird<Torrent>((resolve) => {
		torrentClient.add(magnetURI, (torrent) => {
			torrent.on('done', () => {
				resolve(torrent);
			})
		});
	}).timeout(15000);
}

function makeMagnetURI(infoHash) {
	let magnetURI = `magnet:?xt=urn:btih:${infoHash}&dn=index&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com`;
	return magnetURI;
}

async function fetchIndex(indexInfoHash): Promise<any> {
	let torrentClient = webTorrentClient();
	console.log('> fetchIndex', indexInfoHash);

	try {
		let magnetURI = makeMagnetURI(indexInfoHash);
		let indexTorrent = await fetchTorrent(torrentClient, magnetURI);
		let index = await extractJson(indexTorrent);
		return index;
	} finally {
		await torrentClient.destroyAsync();
		console.log('< fetchIndex');
	}
}

function webTorrentClient(): WebTorrentAsync {
	let client = new WebTorrent({ dht: { verify: ed.verify } });
	Bluebird.promisifyAll((<any>client).dht);
	return <WebTorrentAsync><any>client;
}

function resetTorrentClient(client) {
	return Bluebird
		.map(client.torrents, (torrent) => client.removeAsync(torrent));
}

function findDifferentTiddlers(oldIndex, newIndex): string[] {
	let indexDelta = _.pick(newIndex, (tiddlerInfoHash, tiddlerTitle) => {
		let oldTiddlerInfoHash = oldIndex[tiddlerTitle];
		return tiddlerInfoHash !== oldTiddlerInfoHash;
	});
	let tiddlersInfoHashes = _.values(indexDelta);
	return tiddlersInfoHashes;
}

async function fetchTiddler(
	tiddlersTorrentClient, localStorageAdaptor, tiddlerInfoHash
): Promise<void> {
	let magnetURI = makeMagnetURI(tiddlerInfoHash);
	let tiddlerTorrent = await fetchTorrent(tiddlersTorrentClient, magnetURI);
	let tiddlerFields = await extractJson(tiddlerTorrent);
	saveTiddlerFields(tiddlerFields);
}

class PeerToPeerAdaptor {
	wiki: any;
	logger: any;
	localStorageAdaptor: LocalStorageAdaptor;
	indexTorrentClient: WebTorrentAsync;
	tiddlersTorrentClient: WebTorrentAsync;
	seq = 0;
	mutex = new Mutex();
	index = undefined;

	constructor(options: any) {
		this.localStorageAdaptor = new LocalStorageAdaptor(options);
		this.indexTorrentClient = webTorrentClient();
		this.tiddlersTorrentClient = webTorrentClient();
		this.initIndex();
		this.syncThread();
	}

	name = "p2p";

	seedTiddler(tiddlerFields): Bluebird<TorrentAsync> {
		console.log('Seeding tiddler:', tiddlerFields);
		let buffer = new Buffer(JSON.stringify(tiddlerFields));
		console.log(buffer.toString());

		let tiddlerTorrent = this.tiddlersTorrentClient.get(buffer);
		if (tiddlerTorrent) {
			return Bluebird.resolve(tiddlerTorrent);
		} else {
			return this.tiddlersTorrentClient.seedAsync(buffer, { name: 'tiddler' });
		}
	}

	initIndex() {
		console.log("> initIndex");

		let tiddlers = loadAllTiddlers();

		return this.mutex.runExclusive(() => Bluebird
			.map(_.values(tiddlers), (tiddlerFields) => this.seedTiddler(tiddlerFields))
			.map((tiddlerTorrent: TorrentAsync) => tiddlerTorrent.infoHash)
			.then((tiddlerTorrentsInfoHashes) => {
				console.log("Updating index...");
				this.index = _.object(_.keys(tiddlers), tiddlerTorrentsInfoHashes);
				console.log(this.index);
			})
			.then(() => this.seedIndex())
			.finally(() => console.log("< initIndex"))
		);
	};

	seedIndex() {
		return Bluebird
			.try(() => console.log("> seedIndex"))
			.then(() => resetTorrentClient(this.indexTorrentClient))
			.then(() => {
				let indexJsonBuf = new Buffer(JSON.stringify(this.index));
				console.log("Seeding index...");
				console.log(indexJsonBuf.toString());
				return this.indexTorrentClient.seedAsync(indexJsonBuf, { name: 'index' });
			})
			.then((torrent) => {
				console.log('Index torrent:', torrent);
				console.log('Info hash:', torrent.infoHash);
				console.log('Magnet URI:')
				console.log(torrent.magnetURI);
			})
			.finally(() => console.log("< seedIndex"));
	};

	seedNewIndex(newIndex) {
		let newIndexBuffer = new Buffer(JSON.stringify(newIndex));

		return Bluebird
			.try(() => resetTorrentClient(this.indexTorrentClient))
			.then(() => this.indexTorrentClient.addAsync(
				newIndexBuffer, { name: 'index' }));
	}

	async pull(indexInfoHash) {
		console.log('> pull');

		try {
			let newIndex = await fetchIndex(indexInfoHash);
			console.log('newIndex:', newIndex);
			let differentTiddlers = findDifferentTiddlers(this.index, newIndex);
			await Bluebird.map(differentTiddlers,
				(tiddlerInfoHash) => fetchTiddler(
					this.tiddlersTorrentClient,
					this.localStorageAdaptor,
					tiddlerInfoHash));
			this.index = newIndex;
		} finally {
			console.log('< pull');
		}
	}

	async pushMetadata(dht, cas, seqNext) {
		console.log('> push');

		let indexTorrent = this.indexTorrentClient.torrents[0];
		let indexInfoHash = indexTorrent.infoHash;

		await putIndexMetadata(dht, {
			indexInfoHash: new Buffer(indexInfoHash, 'hex')
		}, cas, seqNext);

		// this.seq = seqNext;

		console.log('< push');
	}

	async sync(dht) {
		console.log('> sync');
		let indexTorrent = this.indexTorrentClient.torrents[0];
		let indexInfoHash = indexTorrent.infoHash;

		let res = await getIndexMetadata(dht);

		if (!res) {
			console.log('DHT entry not found');
			await this.pushMetadata(dht, undefined, this.seq);
		} else {
			let resIndexInfoHash = res.v.indexInfoHash.toString('hex');
			if (resIndexInfoHash == indexInfoHash) {
				this.seq = res.seq;
			}
			if (res.seq < this.seq) {
				console.log('Remote index is out of date', {
					remoteSeq: res.seq,
					localSeq: this.seq
				});
				await this.pushMetadata(dht, res.seq, this.seq);
			} else if (res.seq > this.seq) {
				console.log('Local index is out of date', {
					remoteSeq: res.seq,
					localSeq: this.seq
				});

				await this.pull(resIndexInfoHash);

				this.seq = res.seq;
			} else {
				console.log('Index is up to date');
			}
		}

		console.log('< sync');
	};

	async syncThread() {
		while (true) {
			let dht = new DHT({verify: ed.verify});
			Bluebird.promisifyAll(dht);
			await dht.onAsync('ready');
			try {
				console.log('Trying to sync...');
				await this.mutex.runExclusive(() => this.sync(dht));
			} catch (e) {
				console.error(`Sync error: ${e}`);
				console.info('Retrying...');
			} finally {
				await dht.destroyAsync();
			}
		}
	}

	isReady() {
		return true;
	};

	getTiddlerInfo(tiddler) {
		return this.localStorageAdaptor.getTiddlerInfo(tiddler);
	};

	/*
	Get an array of skinny tiddler fields from the server
	*/
	getSkinnyTiddlers(callback) {
		return Bluebird.resolve(this.mutex.runExclusive(() => Bluebird
			.try(() => console.log('> getSkinnyTiddlers', this.isReady()))
			.then(() => this.localStorageAdaptor.getSkinnyTiddlersAsync())
			.finally(() => console.log('< getSkinnyTiddlers'))
		)).asCallback(callback);
	};

	async saveTiddlerAsync(tiddler) {
		let tiddlerTitle: string = tiddler.fields.title;
		let tiddlerFields = extractFields(tiddler);

		if (tiddlerTitle[0] == '$' || tiddlerTitle.startsWith('Draft')) {
			// await this.localStorageAdaptor.saveTiddlerAsync(tiddler);
		} else {
			try {
				console.log("> saveTiddler", tiddlerTitle);
				let oldTiddlerFields =
					await this.localStorageAdaptor.loadTiddlerAsync(tiddlerTitle);
				if (_.isEqual(oldTiddlerFields, tiddlerFields)) {
					console.log('Tiddler did not change');
					return;
				} else {
					await this.localStorageAdaptor.saveTiddlerAsync(tiddler);
					let tiddlerTorrent = await this.seedTiddler(tiddlerFields);
					this.index[tiddlerTitle] = tiddlerTorrent.infoHash;
					await this.seedIndex();
					++this.seq;
				}
			} finally {
				console.log("< saveTiddler", tiddlerTitle);
			}
		}
	}

	/*
	Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
	*/
	saveTiddler(tiddler, callback) {
		Bluebird
			.resolve(this.mutex.runExclusive(() => this.saveTiddlerAsync(tiddler)))
			.asCallback(callback);
	};

	/*
	Load a tiddler and invoke the callback with (err,tiddlerFields)
	*/
	loadTiddler(title, callback) {
		this.localStorageAdaptor.loadTiddler(title, callback);
	};

	async deleteTiddlerAsync(title, options): Promise<void> {
		Bluebird
			.try(() => {
				console.log("> deleteTiddler", title);
				let tiddlerInfoHash = this.index[title];
				if (tiddlerInfoHash !== undefined) {
					console.log(tiddlerInfoHash);
					return this.tiddlersTorrentClient.removeAsync(tiddlerInfoHash)
						.then(() => delete this.index[title])
						.then(() => this.seedIndex())
						.then(() => this.localStorageAdaptor.deleteTiddlerAsync(title))
				}
			})
			.finally(() => console.log("< deleteTiddler", title));
	}

	/*
	Delete a tiddler and invoke the callback with (err)
	*/
	deleteTiddler(title, callback, options) {
		Bluebird
			.resolve(this.mutex.runExclusive(() => this.deleteTiddlerAsync(title, options)))
			.asCallback(callback);
	};

}

exports.PeerToPeerAdaptor = PeerToPeerAdaptor;
