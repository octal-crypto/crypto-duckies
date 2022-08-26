/** The crypto duckies api. */
var Duckies = {
    /** Private variables and functions */
    _: {}
}

// Calls back when the api is ready
Duckies._.waiting = [];
Duckies.onReady = function(ready) {
    var _ = Duckies._;

    if (_.ready) ready();
    else _.waiting.push(ready);
    if (_.ready == null) {
        _.ready = false;

        // Download the duckie data.
        // The extension is .js because github pages only gzips certain extensions.
        var req = new XMLHttpRequest();
        req.open("GET", "https://octal.art/crypto-duckies/data/static.bin.js");
        req.responseType = "arraybuffer";
        req.onload = function(req){ return function() {
            _.staticReader = new BufferReader(req.response);

            // Parse the number of duckies
            Duckies.numDuckies = new DataView(req.response, 0, 2).getUint16(0);
            
            // Parse the ERC-1155 id prefixes
            _.idPrefixesCount = new DataView(req.response, 2, 3).getUint8(0);
            _.idPrefixLen = new DataView(req.response, 3, 4).getUint8(0);
            _.idPrefixes = 32;
            _.idPrefixIndexes = _.idPrefixes + _.idPrefixesCount * _.idPrefixLen;
            _.idPrefixIndexLen = Math.log2(_.idPrefixesCount);

            // Parse the ERC-1155 id suffixes
            _.idSuffixLen = 256 - _.idPrefixLen;
            _.idSuffixes = _.idPrefixIndexes + Duckies.numDuckies * _.idPrefixIndexLen

            // Parse the traits
            _.traits = _.idSuffixes + _.idSuffixLen * Duckies.numDuckies;
            var traitLen, traitChars = "";
            _.staticReader.read(_.traits, 16, 16, function(numChars) { traitLen = 8*numChars });
            _.staticReader.read(_.traits+=16, traitLen, 8, function(n) { traitChars += String.fromCharCode(n); return true });
            var traitList = traitChars.split("\n");
            Duckies.traitTypes = traitList[0].split(",");
            Duckies.traitValues = traitList.slice(1).map(function(t){ return t.split(",") });
            _.traitIndexLens = Duckies.traitValues.map(function(v){ return Math.ceil(Math.log2(v.length)) });
            _.traitIndexLen = _.traitIndexLens.reduce(function(p,c){ return p+c });
            _.traitIndexIndexes = _.traitIndexLens.slice(0,-1).reduce(function(p,c,i){p[i+1]=c+p[i];return p},[32-_.traitIndexLen]);
            _.traitIndexes = _.traits + traitLen;

            // Parse the palette
            _.palette = _.traitIndexes + Duckies.numDuckies * _.traitIndexLen + 16;
            var paletteLen;
            _.staticReader.read(_.palette-16, 16, 16, function(len) { paletteLen = len });
            _.paletteIndexLen = Math.ceil(Math.log2(paletteLen));

            // Parse the pixels
            _.pixels = _.palette + (40*paletteLen)+32;
            var pixelsLen;
            _.staticReader.read(_.pixels-32, 32, 32, function(len) { pixelsLen = len });
            _.pixelsIndexLen = Math.ceil(Math.log2(pixelsLen));

            // Index
            _.indexes = _.pixels + pixelsLen;

            // Calculate rarity
            Duckies.rarityNormalize = true;
            Duckies.rarityWeights = [0.05, 3, 1, 2, 0.05, 2, 1, 1];
            _.rarityTotalWeight = Duckies.rarityWeights.reduce(function(p,c){return p+c},0);
            _.traitCounts = Duckies.traitTypes.map(function(_,type){
                return Duckies.traitValues[type].map(function(){return 0})
            });
            for (var id=1; id <= Duckies.numDuckies; id++) {
                _.traitsArray(id).forEach(function(value,type) {
                    _.traitCounts[type][value]++;
                });
            }

            // Tell everyone the api is ready
            _.ready = true;
            _.waiting.forEach(function(ready) { ready() });
            _.waiting = [];
        }}(req);
        req.send(null);

        // 
        var req = new XMLHttpRequest();
        req.open("GET", "https://octal.art/crypto-duckies/data/owners.bin.js");
        req.responseType = "arraybuffer";
        req.onload = function(req){ return function() {
            _.ownersReader = new BufferReader(req.response);

            // Read the number of duckies
            Duckies.numDuckies = new DataView(req.response, 0, 2).getUint16(0);
            _.migrated = 16;

            // Read the number of addresses
            _.addresses = _.migrated + Duckies.numDuckies;
            _.ownersReader.read(_.addresses, 16, 16, c => _.addressCount=c);
            _.addresses += 16;

            //
            _.addressIndexes = _.addresses + 160 *_.addressCount
            _.addressIndexLen = Math.ceil(Math.log2(_.addressCount));

            // 
            _.ens = _.addressIndexes + _.addressIndexLen * Duckies.numDuckies
            _.ownersReader.read(_.ens, 32, 32, l => _.ensLen=l);
            _.ens += 32;

            // UTF-16
            var charCodes = [];
            _.ownersReader.read(_.ens, 16*_.ensLen, 16, function(n) { charCodes.push(n); return true });
            _.ensNames = String.fromCharCode.apply(null, charCodes).split(",");

            _.ensIndexes = _.ens + 16*_.ensLen;
            _.ensIndexLen = Math.ceil(Math.log2(_.ensNames.length));
        }}(req);
        req.send(null);
    }
}

Duckies.owner = function(id) {
    var _ = Duckies._;

    // 
    var addressIndex;
    _.ownersReader.read(_.addressIndexes + (id-1)*_.addressIndexLen, _.addressIndexLen, _.addressIndexLen, i => addressIndex = i);

    // 
    var address = "";
    _.ownersReader.read(_.addresses + addressIndex*160, 160, 32, function(i) { address += _.hex(i,4); return true; });

    //
    var ensIndex;
    _.ownersReader.read(_.ensIndexes + addressIndex*_.ensIndexLen, _.ensIndexLen, _.ensIndexLen, function(i) {ensIndex=i});

    var ens = _.ensNames[ensIndex];
    return { address:"0x"+address, ens: ens ? ens : null };
}

Duckies.isMigrated = function(id) {
    var migrated;
    Duckies._.ownersReader.read(Duckies._.migrated + (id-1), 1, 1, function(m) { migrated = m });
    return migrated == 1;
}

Duckies.erc1155Id = function(id) {
    var _ = Duckies._;

    // Read the index of the id prefix
    var prefixIndex;
    _.staticReader.read(_.idPrefixIndexes + (id-1)*_.idPrefixIndexLen,
        _.idPrefixIndexLen, _.idPrefixIndexLen, function(i) { prefixIndex=i });

    // Combine the prefix and suffix, and format in base10
    var prefix = readBinaryString(_.idPrefixes + prefixIndex * _.idPrefixLen, _.idPrefixLen);
    var suffix = readBinaryString(_.idSuffixes + (id-1) * _.idSuffixLen, _.idSuffixLen);
    return binaryToDecimal(prefix + suffix);

    // Read the id prefix and suffix into binary strings
    function readBinaryString(start, length) {
        var binary="";
        _.staticReader.read(start, length, 32, function(s) {
            // In max 32 bit chunks
            var read = Math.min(32, length);
            binary += (s >>> (32-read)).toString(2).padStart(read, "0");
            return (length -= read) > 0;
        });
        return binary;
    }

    // Converts a binary string to a decimal string
    function binaryToDecimal(binary) {
        // The 256-bit ERC-1155 ids are too large for a javascript Number.
        // Use BigInt for base 10 conversion if it's available.
        if (typeof BigInt !== 'undefined') {
            var id = "", bi = BigInt("0b"+binary), zero=BigInt(0), ten=BigInt(10);
            do id = (bi % ten) + id; while ((bi /= ten) > zero);
            return id;
        } else {
            // Otherwise fallback to double dabble -> BCD.
            // https://en.wikipedia.org/wiki/Double_dabble
            // https://en.wikipedia.org/wiki/Binary-coded_decimal
            var bcdLen =  4 * Math.ceil(binary.length/3);
            var scratch = binary.padStart(bcdLen + binary.length, "0");
            for (var i=0; i < binary.length; i++, scratch=scratch.slice(1)+"0") {
                for (var j=0; j < bcdLen; j += 4) { // Increment BCD digits >= 5 by 3
                    var d = parseInt(scratch.slice(j, j+4), 2);
                    if (d >= 5) scratch = scratch.slice(0,j) + (d+3).toString(2) + scratch.slice(j+4);
                }
            }
            for (var i=0, id=""; i < bcdLen; i+=4) id += parseInt(scratch.slice(i, i+4), 2);
            return id.replace(/^0+/, "");
        }
    }
}

/** Returns an object of traits for duckie {id} */
Duckies.traits = function(id) {
    return Duckies._.traitsArray(id).reduce(function(traits,value,type) {
        traits[Duckies.traitTypes[type]] = Duckies.traitValues[type][value];
        return traits;
    }, {});
};

/** Returns an array of trait indexes for duckie {id} */
Duckies._.traitsArray = function(id) {
    var D = Duckies;
    var bits;
    D._.staticReader.read(D._.traitIndexes + (id-1) * D._.traitIndexLen, D._.traitIndexLen, D._.traitIndexLen, function(b){ bits = b });

    return D._.traitIndexIndexes.map(function(idx,i) {
        return D._.slice(bits,idx,D._.traitIndexLens[i])
    })
}

/** Returns the [r,g,b] background color of duckie {id}  */
Duckies.backgroundColor = function(id) {
    var colors = Duckies.traitValues[Duckies.traitTypes.indexOf("Background")];
    var i = colors.indexOf(Duckies.traits(id).Background);
    var bg = [];
    Duckies._.staticReader.read(Duckies._.palette + i * 40, 32, 8, function(b) { return bg.push(b) });
    return bg;
}

/**
 * Streams the pixels for duckie {id}.
 * @param {number} id
 * @param {(color:string) boolean} pixel A function that accepts a 3-length
 * array of [R,G,B,A] values, and returns true if more pixels should be sent.
 */
Duckies.pixels = function(id, blend, pixel) {
    var _ = Duckies._;
    function readIndex(id) {
        var idx;
        _.staticReader.read(_.indexes + (id-1)*_.pixelsIndexLen, _.pixelsIndexLen, _.pixelsIndexLen, function(i) {idx=i});
        return idx;
    }
    var index = readIndex(id);
    var len = readIndex(id+1) - index;
    _.staticReader.read(_.pixels +index , len, _.paletteIndexLen, function(palIdx) {
        var rgbac = [];
        _.staticReader.read(_.palette + palIdx* 40, 40, 8, function(b) { return rgbac.push(b) });
        var rgba = rgbac.slice(0,4);
        if (blend) var rgb = _blend(rgba, Duckies.backgroundColor(id));
        while (rgbac[4]-- > 0) if (!pixel(blend ? rgb : rgba)) return false;
        return true;
    });
};

/** Blends an rgba hex {color} into an rgb {background} **/
function _blend(color, background) {
    var alpha = color[3];
    var blend = (c,b) => c*(alpha/255) + b*(1-alpha/255);
    return [
        blend(color[0],background[0]),
        blend(color[1],background[1]),
        blend(color[2],background[2])
    ];
}

/** Converts {i} to a hex string padded to {bytes} */
(typeof module !== 'undefined' ? module.exports : Duckies._).hex =
function hex(i, bytes) {
    return Math.round(i).toString(16).padStart(bytes*2,"0");
}

/**  */
Duckies.rarity = function(id) {
    return Duckies._.traitsArray(id).map(function(value,type) {
        var counts = Duckies._.traitCounts[type];
        var score = 1 / counts[value];
        if (Duckies.rarityNormalize) score = (score*1000000) / (Duckies._.rarityTotalWeight*counts.length);
        else score *= Duckies.numDuckies;
        return score * Duckies.rarityWeights[type];
    })
}

/**
 * {"type":["value1","value2"]}
 */
Duckies.searchTraits = function(traits) {
    var D = Duckies;

    // Validate and convert the traits object to arrays
    var filterTypes=[], filterValues=[];
    for (var type in traits) {

        // Add the trait types
        var t = D.traitTypes.indexOf(type);
        if (t < 0) {
            throw "Trait " + type + " was not found. " +
                  "Traits are " + D.traitTypes.join(", ");
        }
        filterTypes.push(t);

        // Add the trait values
        var values = filterValues[t] = [];
        traits[type].forEach(function(value) {
            var v = D.traitValues[t].indexOf(value);
            if (v < 0) {
                throw "Trait " + type + " does not have value " + value +
                    ". Values are " + D.traitValues[t].join(", ");
            }
            if (values.indexOf(value) == -1) values.push(v);
        });
    }

    // For each duckie
    var ids = [];
    for (var id=1; id <= Duckies.numDuckies; id++) {

        // Get its traits
        var bits;
        D._.staticReader.read(D._.traitIndexes + (id-1)*D._.traitIndexLen, D._.traitIndexLen, D._.traitIndexLen, function(b){ bits = b });

        // For each filtered type
        for (var f=0,match=true; f < filterTypes.length; f++) {
            var i = filterTypes[f];

            // Check if the duckie matches any of the values
            var value = D._.slice(bits,D._.traitIndexIndexes[i],D._.traitIndexLens[i]);
            for(var v=0,match=false; v < filterValues[i].length; v++) {
                if (filterValues[i][v] == value) { match = true; break; }
            }
            if (!match) break;
        }
        if (match) ids.push(id);
    }
    return ids;
}

Duckies.searchPhoto = function(pixels) {
    // 
    var cropped = crop(pixels);
    // var cropped = [0,0,pixels.width/24];
    function getRow(r) { return Math.min(pixels.height, Math.max(0, Math.round(cropped[0]+r*cropped[2]))) }; // TODO min max?
    function getCol(c) { return Math.min(pixels.width, Math.max(0, Math.round(cropped[1]+c*cropped[2]))) }; // TODO min max?

    //
    function avgPixelArea(row, col) {
        var rgb = [0,0,0];
        var count = 0;
        var counts = {};
        for (var r=getRow(row); r < getRow(row+1); r++) {
            for (var c=getCol(col); c < getCol(col+1); c++, count++) {
                var pixel = getPixel(pixels, r, c);
                rgb[0] += pixel[0];
                rgb[1] += pixel[1];
                rgb[2] += pixel[2];
                var color = (pixel[0]<<16) | (pixel[1]<<8) | pixel[2];
                if (!counts[color]) counts[color] = 0;
                counts[color]++;
                // ((1 << 8) -1) & (color >>> 8)
            }
        }
        return [rgb[0]/count, rgb[1]/count, rgb[2]/count];
    }

    //
    var avg = [];
    for (var row=0; row < 24; row++) {
        var r = [];
        avg.push(r);
        for (var col=0; col < 24; col++) {
            r.push(avgPixelArea(row, col))
        }
    }

    //
    function compareDuckie(id) {
        var row=0; var col=0; var distance = 0;
        var exact = 0;
        Duckies.pixels(id, true, function(rgb) {
            var dist = rgbDist(rgb, avg[row][col]);
            if (dist < 0.02) exact++;
            distance += dist;
            if (++col == 24) { row++; col=0; }
            return true;
        });
        return 0.5*(exact / 576) + 0.5*(1 - (distance / (24*24)));
    }

    var matches = new SortedArray(function(a,b) { return b[1] - a[1] });
    for (var id=1; id <= Duckies.numDuckies; id++) matches.add([id, compareDuckie(id)]);
    return matches.array;
}

// Returns a number from 0-1 measuring the distance between
// the two colors in a weighted Euclidean RGB color space.
// https://wikimedia.org/api/rest_v1/media/math/render/svg/30245af2ec2965d82736adc6762fe7a4591dd19d
// https://www.compuphase.com/cmetric.htm
function rgbDist(color1, color2) {
    var rMean = (color1[0] + color2[0]) / 2;
    var rWeight = 2 + (rMean/256);
    var rDiff = Math.pow(color1[0]-color2[0], 2);

    var gWeight = 4;
    var gDiff = Math.pow(color1[1]-color2[1], 2);

    var bWeight = 2 + ((255-rMean)/256);
    var bDiff = Math.pow(color1[2]-color2[2], 2);

    var dist = Math.sqrt(rWeight*rDiff + gWeight*gDiff + bWeight*bDiff);
    var maxDist = 764.8339663572415; // distance from black to white
    return dist/maxDist;
}

/** Crops to an array [row,col,size] for the duckie */
function crop(pixels) {

    /** Returns the column of the non-black -> black edge */
    var scanEdge = function(row, col, right) {
        var black = function(p) { return rgbDist(p, [0,0,0]) };
        for (var prev=null; col >= 0 && col < pixels.width; right ? col++ : col--) {
            var pixel = getPixel(pixels, row, col);
            if (prev && black(prev) > 0.3 && black(pixel) < 0.3) return col;
            prev=pixel;
        }
    }

    /** Find where the duckie body meets the background */
    for (var row = pixels.height-1; row >=0; row--){
        var left = scanEdge(row, 0, true);
        var right = scanEdge(row, pixels.width-1, false);
        
        if (left && right) {
            var size = (right - left + 1) / 11;
            var row = Math.round(row - (24*size) + 1);
            var col = Math.round(left - (6*size));
            return [row,col,size];
        }
    }
}

/** Maintains a sorted array with an optional length {limit} */
var SortedArray = function(compare, limit) {
    if (!compare) throw "A compare function is required";
    if (!(limit == null || limit >= 1)) throw "limit must be null or >= 1";
    this.array = [];
    this.add = function(item) {
        // If we're under capacity or the item is better than our worst
        if (!limit || this.array.length < limit || compare(item, this.array[limit-1]) < 0) {
            // Then binary search for where it belongs
            var i = binarySearch(this.array, item, compare, true);
            i = i < 0 ? 0 : (compare(item, this.array[i]) < 0 ? i : i+1);
            this.array.splice(i, 0, item);
            if (limit && this.array.length > limit) this.array.splice(limit);
        }
    }
}
if (typeof module !== 'undefined') module.exports.SortedArray = SortedArray;

/** Binary searches for {item} in a sorted {array}.
 *  Returns the index of the closest item, or -1 if the array is empty. */
function binarySearch(array, item, compare) {
    if (!array) throw "An array is required";
    if (!compare) throw "A compare function is required";
    if (array.length == 0) return -1;

    // Binary search for the item
    var min = 0;
    var max = array.length-1;
    var i = 0;
    var comp = 0;
    while (min <= max) {
        i = Math.floor((min + max) / 2);
        comp = compare(item, array[i]);
        if (comp == 0) return i;
        if (comp > 0) min = i+1;
        else max = i-1;
    }

    // Once it's down to 2, compare them
    var other = comp < 0 ? i-1 : i+1;
    if (other < 0 || other >= array.length) return i;
    return Math.abs(compare(item, array[i]))
         < Math.abs(compare(item, array[other]))
         ? i : other;
} 
if (typeof module !== 'undefined') module.exports.binarySearch = binarySearch;

// returns an array containing [r,g,b] values for the pixel
function getPixel(pixels, row, col) {
    var idx = 4 * (row * pixels.width + col);
    return [pixels.data[idx], pixels.data[idx+1], pixels.data[idx+2]];
}

/** 
 * Buffers bits and flushes them after a specified length.
 * @param {number} flushLen The number of bits to flush.
 * @param {(bits:number) boolean} flush A function that accepts
 * {flushLen} bits and returns whether more bits should be flushed.
 */
 (typeof module !== 'undefined' ? module.exports : Duckies._).BitBuffer =
 function(flushLen, flush) {
     if (!(flushLen >= 1 && flushLen <= 32)) throw "Flush length must be from 1-32. Received " + flushLen;
     if (!flush) throw "A flush function is required";
     this.buffer = 0;
     this.idx = 0;
 
     /**
      * Appends the lowest {len} bits to the buffer.
      * @param {number} bits
      * @param {number} len
      * @returns true if the reader is still reading, otherwise false.
      */
      this.append = function(bits, len) {
        if (len == 0) return true;
        else if (!len || len < 0) throw "Length must be >= 0. Received "+len;
        else if (typeof(bits) == "bigint") {
            // Append BigInts in max 32-bit chunks
            for (var written=0,toWrite; written < len; written+=toWrite) {
                toWrite = Math.min(32, len-written);
                var shift = bits >> BigInt(len-written-toWrite);
                var crop = Number(shift & BigInt(~0 >>> 0));
                this.append(crop, toWrite);
            }
        }
        else if (len > 32) throw "Length must be 0-32. Received "+len;
        else {
            bits &= (~0 >>> (32-len)); // Crop to the desired number of bits
            var extra = this.idx + len - flushLen;
            if (extra >= 0) { // If the buffer can be filled
                this.buffer |= (bits >>> extra); // Then fill it
                this.idx = flushLen; // Flush it, and recurse with the extra bits
                return this.flush() ? this.append(bits & (~0 >>> (32-extra)), extra) : false;
            } else { // Otherwise add the bits to the buffer
                this.buffer |= bits << (extra*-1);
                this.idx += len;
                return true;
            }
        }
     };
 
     /**
      * Flushes the buffer.
      * @returns null if there's no data to flush, true if
      * the reader is still reading, and false otherwise.
      */
     this.flush = function() {
         if (this.idx == 0) return null;
         var more = flush(this.buffer >>> 0);
         this.buffer = 0;
         this.idx = 0;
         return more;
     }
}

/** Allows reading a buffer from any bit offset + length */
function BufferReader(buffer) {
    /**
     * Reads {len} bits of {buffer}, starting from bit {index}, flushing every {flushLen} bits.
     * @param {(bits:number) boolean} flush A function that accepts
     * {flushLen} bits and returns whether more bits should be flushed.
     * @returns true if the reader is still reading, false otherwise.
     */
    this.read = function(index, len, flushLen, flush) {
        if (index == null) throw "An index to the buffer is required";
        if (len == null) throw "A bit length is required";
        if (index + len > 8*buffer.byteLength) throw "index + len overflows buffer";
        if (!(flushLen >= 1 && flushLen <= 32)) throw "Flush length must be from 1-32. Received " + flushLen;
        if (flush == null) throw "A flush function is required";

        // Read up to 32 bits at a time, repeating as necessary.
        var bitBuffer = new Duckies._.BitBuffer(flushLen, flush);
        function _read(index, length) {
            // Byte align the read
            var offset = index % 8;
            var offsetLen = offset + length;

            // Read 8, 16, or 32 bits depending on the length
            var size = (offsetLen > 16 && (index/8)+4 <= buffer.byteLength) ? 32 : (offsetLen > 8 ? 16 : 8);
            var view = new DataView(buffer, index/8, size/8);
            var chunk = size == 8 ? view.getUint8(0) : size == 16 ? view.getUint16(0) : view.getUint32(0);

            // Flush bits to the reader
            var read =  Math.min(length, size-offset);
            var bits =  Duckies._.slice(chunk, offset+(32-size), read);
            var more = bitBuffer.append(bits, read);
    
            // Recurse if there's more
            return more && length > read ? _read(index+read, length-read) : more;
        }
    
        if (_read(index, len)) {
            var more = bitBuffer.flush();
            return more != null ? more : true;
        }
        return false;
    };
}

/** Returns {len} bits starting from {index} */
 Duckies._.slice = function(bits, index, len) {
    if (bits == null) throw "bits are required";
    if (!(index >=0 && index <= 32)) throw "index must be from 0-32. Received " + index;
    if (!(len >=0 && len <= 32)) throw "len must be from 0-32. Received " + len;
    if (index + len > 32) throw "slice must be <= 32 bits";
    if (len == 0) return 0;
    return (bits >>> (32-index-len)) & (~0 >>> (32-len));
};

// Polyfill for padStart
if (!String.prototype.padStart) {
    String.prototype.padStart = function padStart(len, pad) {
        return this.length > len ? this :
            Array(len - this.length + 1).join(pad) + this;
    };
}

// Polyfill for log2
if (!Math.log2) Math.log2 = function(x) {
    return Math.log(x) * Math.LOG2E;
};

// Polyfill for isInteger
if (!Number.isInteger) Number.isInteger = function(i) {
    return !isObject(i) && isFinite(i) && floor(i) === i;
};
