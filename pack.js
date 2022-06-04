const fs = require("fs");
const {readDuckie} = require("./sync");
const {BitBuffer, hex} = require("./api");

(async function main() {
    if (require.main !== module) return;
    packStatic();
    packOwners();
})().catch(e => { console.error(e); process.exitCode = 1; });

/** Packs data that doesn't change (pixels, traits, and ERC-1155 IDs) */
function packStatic() {
    const duckies=[], palette=[], traitTypes=[], traitValues=[[]], bgColors=new Map();

    // Read each duckie
    for (let id=1; id <= 5000; id++) {
        const input = readDuckie(id);
        const duckie = { id1155:BigInt(input.id1155), palette:[], traits:[] };
        duckies.push(duckie);

        // Parse the pixels into a palette
        for (const pal of getPalette(input)) {
            duckie.palette.push(indexOrPush(palette,pal));
        }

        // Parse the traits
        duckie.traitCount = input.traits.length;
        for (const trait of input.traits) {
            let i = indexOrPush(traitTypes, trait.trait_type);
            if (i >= traitValues.length) traitValues.push([]);
            duckie.traits[i] = indexOrPush(traitValues[i], trait.value);
            if (trait.trait_type == "Background" && !bgColors.has(trait.value)) {
                bgColors.set(trait.value, input.backgroundColor.slice(2));
            }
        }

        // Find traits that are common to all duckies
        var commonTraits = !commonTraits ? input.traits.map(t=>t.trait_type) :
            commonTraits.filter(type => input.traits.some(t=>t.trait_type==type));
    }

    // Add a None value for traits that aren't common
    traitTypes.forEach((t,i) => {if (!commonTraits.includes(t)) traitValues[i].push("None")});

    // Add a trait for the number of traits
    traitTypes.push("Trait Count");
    traitValues.push(duckies.reduce((p,c) => {
        c.traits[traitTypes.length-1] = indexOrPush(p, c.traitCount);
        return p;
    }, []));

    // The extension is .js because github pages only gzips certain extensions
    const file = "data/static.bin.js";
    fs.writeFileSync(file, "");
    const buffer = new BitBuffer(8, b => fs.appendFileSync(file, Buffer.from([b])) || true);

    // Write the number of duckies
    buffer.append(duckies.length, 16);

    // Write the ERC-1155 id prefixes
    const prefixes=[], prefixLen=203, suffixLen=256-prefixLen;
    duckies.forEach(d => indexOrPush(prefixes, d.id1155 >> BigInt(suffixLen)));
    buffer.append(prefixes.length, 8);
    buffer.append(prefixLen, 8);
    prefixes.forEach(prefix => buffer.append(prefix, prefixLen));

    // Write each duck's id prefix
    const prefixIdxLen = Math.ceil(Math.log2(prefixes.length));
    duckies.forEach(duck => buffer.append(
        prefixes.indexOf(duck.id1155 >> BigInt(suffixLen)), prefixIdxLen));

    // Write each duck's id suffix
    duckies.forEach(duck => buffer.append(duck.id1155, suffixLen));

    // Write the trait types and values
    const traitStr = [traitTypes,...traitValues].join("\n");
    buffer.append(traitStr.length, 16);
    [...traitStr].forEach(s => buffer.append(s.charCodeAt(0), 8));

    // Write each duckie's traits
    const traitIdxLens = traitValues.map(v => Math.ceil(Math.log2(v.length)));
    duckies.forEach(d => traitValues.forEach((v,i) =>
        buffer.append(d.traits[i] ?? v.length-1, traitIdxLens[i])));

    // Write the color palette
    palette.unshift(...[...bgColors.values()].map(bg => bg+"01"));
    buffer.append(palette.length, 16);
    [...palette.join("")].forEach(s => buffer.append(parseInt(s, 16), 4));

    // Write each duckies pixels
    const palIdxLen = Math.ceil(Math.log2(palette.length));
    const pixelsLen = duckies.reduce((p,c) => p + palIdxLen*c.palette.length, 0);
    buffer.append(pixelsLen, 32);
    duckies.forEach(d => d.palette.forEach(palIdx =>
        buffer.append(bgColors.size + palIdx, palIdxLen))); 

    // Write an index pointing to each duckie's pixels
    const duckIdxLen = Math.ceil(Math.log2(pixelsLen));
    let i=0;
    buffer.append(i, duckIdxLen);
    duckies.forEach(d => buffer.append(i += (palIdxLen*d.palette.length), duckIdxLen));
    buffer.flush();
}

/**  */
function packOwners() {
    // The extension is .js because github pages only gzips certain extensions
    const file = "data/owners.bin.js";
    fs.writeFileSync(file, "");
    const buffer = new BitBuffer(8, b => fs.appendFileSync(file, Buffer.from([b])) || true);

    // Write the number of duckies
    buffer.append(5000, 16);

    // Map address -> ENS
    const addressToEns = new Map();
    for (let id=1; id <= 5000; id++) {
        const duckie = readDuckie(id);
        addressToEns.set(duckie.owner, duckie.ens);

        // Write the migration data
        buffer.append(duckie.migrated ? 1 : 0, 1);
    }

    // Write the addresses
    const addressList = Array.from(addressToEns.keys());
    buffer.append(addressList.length, 16);
    addressList.forEach(a => buffer.append(BigInt(a), 160));

    // Write the owners
    const addressIdxLen = Math.ceil(Math.log2(addressList.length));
    for (let id=1; id <= 5000; id++) {
        const address = readDuckie(id).owner;
        buffer.append(addressList.indexOf(address), addressIdxLen);
    }

    // Write the ENS names
    const ensList = Array.from(new Set(addressToEns.values()));
    const ensStr = ensList.join(",");
    buffer.append(ensStr.length, 32);
    [...ensStr].forEach(n => {
        // UTF-16, either 1 or 2 char codes
        buffer.append(n.charCodeAt(0), 16);
        if (n.charCodeAt(1)) buffer.append(n.charCodeAt(1), 16);
    });

    // Write the address -> ENS mapping
    const ensIdxLen = Math.ceil(Math.log2(ensList.length));
    addressList.forEach(a => buffer.append(ensList.indexOf(addressToEns.get(a)), ensIdxLen));
    buffer.flush();
}

/** Yields a color palette of 10 character RGBAC hex strings
 *  where C represents the count of consecutive pixels. */
function* getPalette(duckie) {
    for (let i=2,count=0,prev; i <= duckie.imagePixels.length; i+=8,count++) {
        const color = duckie.imagePixels.slice(i, i+8);

        // Combine adjacent pixels with the same color
        if (color != (prev??=color) || count >= 255) {
            yield prev + hex(count, 1);
            prev=color;
            count = 0;
        }
    }
}

/** Returns the index of {item} in {array}, pushing if necessary */
function indexOrPush(array, item) {
    const i = array.indexOf(item);
    return i != -1 ? i : (array.push(item)-1);
}

module.exports = {getPalette};
