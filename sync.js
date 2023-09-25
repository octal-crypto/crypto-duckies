const Web3 = require("web3");
const fs = require('fs');

/* Duckie schema:
{
    "id": 1,
    "id1155": "",
    "traits": [{"trait_type": "", "value": ""}],
    "backgroundColor": "",
    "imagePixels": "",
    "imageSVG": "",
    "migrated": true,
    "owner": "",
    "ens": ""
}
*/
const duckieFile = id => `data/duckies/duckie${id}.json`; // File for duckie {id}
const duckiesFile = "data/duckies.json"; // File with data for all duckies
const blockFile = "data/block.json"; // File checkpointing the previous sync

/** Syncs changes since the previous sync */
(async function main() {
    if (require.main !== module) return;
    if (!process.env.ETH_RPC) throw "Set ETH_RPC environment variable";
    const web3 = new Web3(new Web3.providers.HttpProvider(process.env.ETH_RPC));

    // If we're starting from scratch, sync the static data
    if (!fs.existsSync(blockFile)) {
        await syncStatic();
        var fromBlock = 0;
    } else {
        // Otherwise resume from the previously synced block
        var fromBlock = JSON.parse(fs.readFileSync(blockFile)).blockNumber + 1;
    }

    // Sync data that changes (owners, migration, ENS)
    const toBlock = await web3.eth.getBlockNumber();
    if (fromBlock <= toBlock) {
        console.log("Syncing blocks %d to %d", fromBlock, toBlock);
        await syncOwners(fromBlock, toBlock);
        await syncEns();
    }

    // Record what block we're synced to
    console.log(`Synced to block ${toBlock}`);
    fs.writeFileSync(blockFile, JSON.stringify(
        { blockNumber:toBlock, epochSeconds:Math.round(Date.now()/1000) }));

})().catch(e => { console.error(e); process.exitCode = 1; });

/** Syncs data that doesn't change (pixels, traits, and ERC-1155 IDs) */
async function syncStatic() {
    if (!process.env.ETH_RPC) throw "Set ETH_RPC environment variable";
    const api = duckiesApi(new Web3(new Web3.providers.HttpProvider(process.env.ETH_RPC)));
    for (let id=1; id <= 5000; id++) {
        const duckie = readDuckie(id);
        duckie.id1155 = await retry(() => api.methods.toERC1155TokenId(id).call()),
        duckie.traits = JSON.parse(await retry(() => api.methods.traits(id).call())),
        duckie.backgroundColor = await retry(() => api.methods.backgroundColor(id).call()),
        duckie.imagePixels = await retry(() => api.methods.imagePixels(id, false).call()),
        duckie.imageSVG = await retry(() => api.methods.imageSVG(id).call())
        writeDuckie(duckie);
    }
}

/** Syncs owners of ERC-1155 and ERC-721 duckies */
async function syncOwners(fromBlock, toBlock) {
    if (!process.env.ETH_RPC) throw "Set ETH_RPC environment variable";
    const web3 = new Web3(new Web3.providers.HttpProvider(process.env.ETH_RPC));
    
    // Map from ERC-1155 to ERC-721 ids
    const idMap = new Map();
    for (let id=1; id <= 5000; id++) {
        const duckie = readDuckie(id);
        idMap.set(duckie.id1155, duckie.id);
    }

    // Map from duckie id to owner address
    const owners = new Map();

    // Query ERC-1155 transfer events
    const erc1155 = erc1155Api(web3);
    const retriable = e => !["returned more than","size exceeded","server error"].some(m=>e.toString().includes(m));
    const erc1155Query = queryBlocks(fromBlock, toBlock, async (from, to) => [
        ...await retry(() => erc1155.getPastEvents("TransferSingle", {fromBlock:from, toBlock:to}), retriable),
        ...await retry(() => erc1155.getPastEvents("TransferBatch", {fromBlock:from, toBlock:to}), retriable)
    ]);

    for await (const transfers of erc1155Query) {
        // For each ERC-1155 transfer
        for (const t of transfers) {
            for (const id1155 of t.returnValues.ids ?? [t.returnValues.id]) {

                // If it's a duckie
                const id = idMap.get(id1155);
                if (id !== undefined) {

                    // Then sync the new owner
                    owners.set(id, t.returnValues.to);
                    console.log(
                        "Synced ERC-1155 transaction %s: Duckie %d to owner %s",
                        t.transactionHash, id, t.returnValues.to);
                }
            }
        }
    }

    // Set of migrated duckie ids
    const migrated = new Set();

    // Query ERC-721 transfer events
    const erc721 = duckiesApi(web3);
    const erc721Query = queryBlocks(fromBlock, toBlock, (from, to) => retry(() =>
        erc721.getPastEvents("Transfer", {fromBlock:from, toBlock:to}), retriable));

    for await (const transfers of erc721Query) {
        for (const t of transfers) {
            const id = parseInt(t.returnValues.tokenId);
            owners.set(id, t.returnValues.to);
            migrated.add(id);
            console.log(
                "Synced ERC-721 transaction %s: Duckie %d to owner %s",
                t.transactionHash, id, t.returnValues.to);
        }
    }

    // Rewrite data with the latest owners and migrations
    for (let id=1; id <= 5000; id++) {
        const duckie = readDuckie(id);
        const owner = owners.get(duckie.id)
        if (!duckie.migrated) duckie.migrated = migrated.has(duckie.id);
        if (owner !== undefined) duckie.owner = owner;
        writeDuckie(duckie)
    }
}

/** Executes a function over a range of blocks,
    breaking into smaller chunks if necessary */
async function* queryBlocks(fromBlock, toBlock, fn) {
    for (let from=fromBlock, to=toBlock; from < to;) {
        try { yield await fn(from, to) }
        catch {
            // Query fewer blocks next time
            to = Math.round((from+to)/2);
            continue;
        }

        // Find the next range of blocks to query
        const numBlocks = to - from;
        from = to;
        to = Math.min(toBlock, from + Math.round(1.1*numBlocks));
    }
}

/** Syncs ENS names of duckie owners */
async function syncEns() {
    if (!process.env.ETH_RPC) throw "Set ETH_RPC environment variable";
    const ens = ensApi(new Web3(new Web3.providers.HttpProvider(process.env.ETH_RPC)));

    // Find the set of unique addresses
    const addressSet = new Set();
    for (let id=1; id <= 5000; id++) {
        addressSet.add(readDuckie(id).owner);
    }

    // Reverse resolve their ENS names
    const addressList = Array.from(addressSet);
    let names = await retry(() => ens.methods.getNames(addressList).call());

    // Rewrite data with the latest ENS names
    for (let id=1; id <= 5000; id++) {
        const duckie = readDuckie(id);
        const name = names[addressList.indexOf(duckie.owner)]
        if (name != (duckie.ens ?? "")) {
            console.log("Synced ENS name %s for address %s and duckie %d", name, duckie.owner, id);
        }
        name ? duckie.ens = name : delete duckie.ens;
        writeDuckie(duckie);
    }
}

/** Reads duckie {id} from file */
function readDuckie(id) {
    try { return JSON.parse(fs.readFileSync(duckieFile(id))) }
    catch (e) { if (e.code == "ENOENT") return {"id":id}; else throw e;}
}

/** Writes the {duckie} to files */
function writeDuckie(duckie) {
    const json = JSON.stringify(duckie, null, 4);
    fs.writeFileSync(duckieFile(duckie.id), json);
    if(duckie.id == 1) fs.writeFileSync(duckiesFile, "[");
    fs.appendFileSync(duckiesFile, json + (duckie.id < 5000 ? ",\n" : "]"));
}

/** Retries {retriable} errors from {func} with {delay}
  * backoff increased by {mult} and optional {jitter} */
 async function retry(func, retriable=(()=>true), delay=500, mult=1.2, jitter=true) {
    try { return await func(); }
    catch (e) {
        if (!retriable(e)) throw e;
        const ms = Math.round(delay * (jitter ? 2*Math.random() : 1));
        console.warn("Retrying in %dms: %s", ms, e);
        await new Promise(r => setTimeout(r, ms));
        return retry(func, retriable, delay*mult, mult, jitter);
    }
}

/** ABI contract for ERC-721 crypto duckies */
function duckiesApi(web3) {
    return new web3.eth.Contract([
    {
        "name":"toERC1155TokenId", "stateMutability":"view", "type":"function", 
        "inputs": [{"internalType":"uint256", "name":"tokenId", "type":"uint256"}],
        "outputs": [{"internalType":"uint256", "name":"tokenIdERC1155", "type":"uint256"}]
    },
    {
        "name":"traits", "type":"function", "stateMutability":"view",
        "inputs":[{"internalType":"uint256", "name":"tokenId", "type":"uint256"}],
        "outputs":[{"internalType":"string", "name":"text", "type":"string"}]
    },
    {
        "name":"backgroundColor", "type":"function", "stateMutability":"view",
        "inputs":[{"internalType":"uint256", "name":"tokenId", "type":"uint256"}],
        "outputs":[{"internalType":"bytes4", "name":"", "type":"bytes4"}],
    },
    {
        "name":"imagePixels", "type":"function", "stateMutability":"view",
        "inputs":[
            {"internalType":"uint256", "name":"tokenId", "type":"uint256"},
            {"internalType":"bool", "name":"premultipliedAlpha", "type":"bool"}
        ],
        "outputs":[{"internalType":"bytes", "name":"", "type":"bytes"}]
    },
    {
        "name":"imageSVG", "type":"function", "stateMutability":"view",
        "inputs":[{"internalType":"uint256", "name":"tokenId", "type":"uint256"}],
        "outputs":[{"internalType":"string", "name":"svg", "type":"string"}],
    },
    {
        "name":"Transfer", "type":"event", "anonymous": false,
        "inputs": [
            {"indexed": true,"internalType":"address", "name":"from", "type":"address"},
            {"indexed": true,"internalType":"address", "name":"to", "type":"address"},
            {"indexed": true,"internalType":"uint256", "name":"tokenId", "type":"uint256"}
        ]
    }], "0x922dc160f2ab743312a6bb19dd5152c1d3ecca33");
}

/** ABI contract for ERC-1155 transfer events from OpenSea's shared storefront */
function erc1155Api(web3) {
    return new web3.eth.Contract([
    {
        "name":"TransferSingle", "type":"event", "anonymous": false,
        "inputs": [
            {"indexed": true,"internalType":"address", "name":"operator", "type":"address"},
            {"indexed":  true,"internalType":"address", "name":"from", "type":"address"},
            {"indexed": true,"internalType":"address", "name":"to", "type":"address"},
            {"indexed": false,"internalType":"uint256", "name":"id", "type":"uint256"},
            {"indexed": false,"internalType":"uint256", "name":"value", "type":"uint256"}
        ]
    },
    {
        "name":"TransferBatch", "type":"event", "anonymous": false,
		"inputs": [
			{"indexed":true, "internalType":"address", "name":"operator", "type":"address"},
			{"indexed":true, "internalType":"address", "name":"from", "type":"address"},
			{"indexed":true, "internalType":"address", "name":"to", "type":"address"},
			{"indexed":false, "internalType":"uint256[]", "name":"ids", "type":"uint256[]"},
			{"indexed":false, "internalType":"uint256[]", "name":"values", "type":"uint256[]"}
		]
	}], "0x495f947276749ce646f68ac8c248420045cb7b5e");
}

/** ABI contract for ENS reverse records */
function ensApi(web3) {
    return new web3.eth.Contract([{
        "name":"getNames", "type":"function", "stateMutability":"view",
        "inputs": [{"internalType":"address[]", "name":"addresses", "type":"address[]"}],
        "outputs": [{"internalType":"string[]", "name":"r", "type":"string[]"}]
    }], "0x3671aE578E63FdF66ad4F3E12CC0c0d71Ac7510C");
}

module.exports = {readDuckie};
