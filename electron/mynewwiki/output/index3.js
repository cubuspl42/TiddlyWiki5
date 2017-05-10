let WebTorrent = require('webtorrent');

let infoHash = '4292e9af8c635a4116d9a1b88fb62ffc5c3b9b93'
// let torrentId = `magnet:?xt=urn:btih:${infoHash}&tr=udp%3A%2F%2Fexodus.desync.com%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.internetwarriors.net%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com`;
let torrentId = 'magnet:?xt=urn:btih:4292e9af8c635a4116d9a1b88fb62ffc5c3b9b93&dn=Hello&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com';
let client = new WebTorrent();

client.on('error', (error) => {
    console.log(`ERROR: ${error}`);
});

console.log(`Adding torrent ${torrentId}`)
client.add(torrentId, (torrent) => {
    console.log('Torrent ready');

    torrent.on('warning', (warning) => {
        console.log(`WARNING: ${warning}`);
    });

    torrent.on('done', () => {
        console.log('Torrent done');
        for(let file of torrent.files) {
            file.getBuffer((err, buffer) => {
                if (err) throw err;
                console.log(buffer.toString('utf8'));
            });
        }
    });
});
