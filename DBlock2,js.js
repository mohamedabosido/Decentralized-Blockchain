const crypto = require("crypto"); SHA256 = message => crypto.createHash("sha256").update(message).digest("hex");
const EC = require("elliptic").ec, ec = new EC("secp256k1");
const { Block, Blockchain, Transaction, chain } = require("./Block");

//Constant Key 
const MINT_PRIVATE_ADDRESS = "0700a1ad28a20e5b2a517c00242d3e25a88d84bf54dce9e1733e6096e6d6495e";
const MINT_KEY_PAIR = ec.keyFromPrivate(MINT_PRIVATE_ADDRESS, "hex");
const MINT_PUBLIC_ADDRESS = MINT_KEY_PAIR.getPublic("hex");

const privateKey = "39a4a81e8e631a0c51716134328ed944501589b447f1543d9279bacc7f3e3de7";
const keyPair = ec.keyFromPrivate(privateKey, "hex");
const publicKey = keyPair.getPublic("hex");

const WS = require("ws");

//Port 3001 for this peer with 3000
const PORT = 3001;
const PEERS = ["ws://localhost:3000"];
const MY_ADDRESS = "ws://localhost:3001";
const server = new WS.Server({ port: PORT });

let opened = [], connected = [];
let check = [];
let checked = [];
let checking = false;
let tempChain = new Blockchain();

//print this in console
console.log("Listening on PORT", PORT);

server.on("connection", async (socket, req) => {
    socket.on("message", message => {
        const _message = JSON.parse(message);

        console.log(_message);

        switch(_message.type) {
            case "TYPE_REPLACE_CHAIN":
                const [ newBlock, newDiff ] = _message.data;

                const ourTx = [...chain.transactions.map(tx => JSON.stringify(tx))];
                const theirTx = [...newBlock.data.filter(tx => tx.from !== MINT_PUBLIC_ADDRESS).map(tx => JSON.stringify(tx))];
                const n = theirTx.length;

                if (newBlock.prevHash !== chain.getLastBlock().prevHash) {
                    for (let i = 0; i < n; i++) {
                        const index = ourTx.indexOf(theirTx[0]);

                        if (index === -1) break;
                        
                        ourTx.splice(index, 1);
                        theirTx.splice(0, 1);
                    }

                    if (
                        theirTx.length === 0 &&
                        SHA256(chain.getLastBlock().hash + newBlock.timestamp + JSON.stringify(newBlock.data) + newBlock.nonce) === newBlock.hash &&
                        newBlock.hash.startsWith("000" + Array(Math.round(Math.log(chain.difficulty) / Math.log(16) + 1)).join("0")) &&
                        Block.hasValidTransactions(newBlock, chain) &&
                        (parseInt(newBlock.timestamp) > parseInt(chain.getLastBlock().timestamp) || chain.getLastBlock().timestamp === "") &&
                        parseInt(newBlock.timestamp) < Date.now() &&
                        chain.getLastBlock().hash === newBlock.prevHash &&
                        (newDiff + 1 === chain.difficulty || newDiff - 1 === chain.difficulty)
                    ) {
                        chain.chain.push(newBlock);
                        chain.difficulty = newDiff;
                        chain.transactions = [...ourTx.map(tx => JSON.parse(tx))];
                    }
                } else if (!checked.includes(JSON.stringify([newBlock.prevHash, chain.chain[chain.chain.length-2].timestamp || ""]))) {
                    checked.push(JSON.stringify([chain.getLastBlock().prevHash, chain.chain[chain.chain.length-2].timestamp || ""]));

                    const position = chain.chain.length - 1;

                    checking = true;

                    sendMessage(produceMessage("TYPE_REQUEST_CHECK", MY_ADDRESS));

                    setTimeout(() => {
                        checking = false;

                        let mostAppeared = check[0];

                        check.forEach(group => {
                            if (check.filter(_group => _group === group).length > check.filter(_group => _group === mostAppeared).length) {
                                mostAppeared = group;
                            }
                        })

                        const group = JSON.parse(mostAppeared)

                        chain.chain[position] = group[0];
                        chain.transactions = [...group[1]];
                        chain.difficulty = group[2];

                        check.splice(0, check.length);
                    }, 5000);
                }

                break;

            case "TYPE_REQUEST_CHECK":
                opened.filter(node => node.address === _message.data)[0].socket.send(
                    JSON.stringify(produceMessage(
                        "TYPE_SEND_CHECK",
                        JSON.stringify([chain.getLastBlock(), chain.transactions, chain.difficulty])
                    ))
                );

                break;

            case "TYPE_SEND_CHECK":
                if (checking) check.push(_message.data);

                break;

            case "TYPE_CREATE_TRANSACTION":
                const transaction = _message.data;

                chain.addTransaction(transaction);

                break;

            case "TYPE_SEND_CHAIN":
                const { block, finished } = _message.data;

                if (!finished) {
                    tempChain.chain.push(block);
                } else {
                    tempChain.chain.push(block);
                    if (Blockchain.isValid(tempChain)) {
                        chain.chain = tempChain.chain;
                    }
                    tempChain = new Blockchain();
                }

                break;

            case "TYPE_REQUEST_CHAIN":
                const socket = opened.filter(node => node.address === _message.data)[0].socket;
                
                for (let i = 1; i < chain.chain.length; i++) {
                    socket.send(JSON.stringify(produceMessage(
                        "TYPE_SEND_CHAIN",
                        {
                            block: chain.chain[i],
                            finished: i === chain.chain.length - 1
                        }
                    )));
                }

                break;

            case "TYPE_REQUEST_INFO":
                opened.filter(node => node.address === _message.data)[0].socket.send(JSON.stringify(produceMessage(
                    "TYPE_SEND_INFO",
                    [chain.difficulty, chain.transactions]
                )));

                break;

            case "TYPE_SEND_INFO":
                [ chain.difficulty, chain.transactions ] = _message.data;
                
                break;

            case "TYPE_HANDSHAKE":
                const nodes = _message.data;

                nodes.forEach(node => connect(node))
        }
    });
})

async function connect(address) {
	if (!connected.find(peerAddress => peerAddress === address) && address !== MY_ADDRESS) {
		const socket = new WS(address);

		socket.on("open", () => {
			socket.send(JSON.stringify(produceMessage("TYPE_HANDSHAKE", [MY_ADDRESS, ...connected])));

			opened.forEach(node => node.socket.send(JSON.stringify(produceMessage("TYPE_HANDSHAKE", [address]))));

			if (!opened.find(peer => peer.address === address) && address !== MY_ADDRESS) {
				opened.push({ socket, address });
			}

			if (!connected.find(peerAddress => peerAddress === address) && address !== MY_ADDRESS) {
				connected.push(address);
			}
		});

		socket.on("close", () => {
			opened.splice(connected.indexOf(address), 1);
			connected.splice(connected.indexOf(address), 1);
		});
	}
}

function produceMessage(type, data) {
	return { type, data };
}

function sendMessage(message) {
	opened.forEach(node => {
		node.socket.send(JSON.stringify(message));
	})
}

process.on("uncaughtException", err => console.log(err));

PEERS.forEach(peer => connect(peer));

//The process
setTimeout(() => {
	if (chain.transactions.length !== 0) {
		chain.mineTransactions(publicKey);

		sendMessage(produceMessage("TYPE_REPLACE_CHAIN", [
			chain.getLastBlock(),
			chain.difficulty
		]))
	}
}, 6500);

//uses the chain in BlockChain
setTimeout(() => {
	console.log(opened);
	console.log(chain);
}, 10000);