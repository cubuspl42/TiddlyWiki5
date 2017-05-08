let ed = require('ed25519-supercop');

var seed = ed.createSeed();
var keypair = ed.createKeyPair(seed);
var publicKey = keypair.publicKey.toString('hex');
var secretKey = keypair.secretKey.toString('hex');

console.log({
	publicKey: publicKey,
	secretKey: secretKey
});