const {BitBuffer,binarySearch,SortedArray} = require("./api.js");
const {getPalette} = require("./pack.js");

(function testBitBuffer() {
    for (var flushLen=1; flushLen <= 32; flushLen++)
    {
        // Verify bytes as they're flushed
        let bitStr = "";
        const buffer = new BitBuffer(flushLen, byte => {
            const expected = parseInt(bitStr.slice(0,flushLen).padEnd(flushLen, "0"), 2);
            if (expected != byte) throw `Expected ${expected}, found ${byte}`;
            bitStr = bitStr.slice(flushLen);
            return true;
        });

        // Append random lengths of random sequences of bits
        for (let i=0; i < 10000; i++) {
            const bits = random(0, ~0>>>0);
            const len = random(0, 32);
            bitStr += len ? bits.toString(2).slice(-len).padStart(len,"0") : "";
            buffer.append(bits, len);
            if (i % 100 === 0) buffer.flush(); // Flush the buffer occasionally
        }
        buffer.flush();
        if (bitStr != "") throw `Expected ${bitStr.length} more bits`;
    }
})();

(function testPalette() {
    // Generate a random RGBAC color palette
    let palette = new Set();
    const color = ()=> random(0, ~0>>>8).toString(16).padStart(6,"0");
    const count = ()=> random(1, ~0>>>24).toString(16).padStart(2,"0");
    for (let i=0; i < 10000; i++) {
        palette.add(`${color()}ff${count()}`); // opaque
        palette.add(`00000000${count()}`); // transparent => background color
    }
    palette = [...palette];

    // Convert the palette to a list of pixels
    const duck = {
        backgroundColor: `0x${color()}ff`,
        imagePixels: "0x"+palette.map(p =>
            p.slice(0,8).repeat(parseInt(p.slice(8,10),16))).join("")
    };

    // Verify that the pixels convert back to the same palette
    let i=0;
    for (const actual of getPalette(duck)) {
        let expected = palette[i++];
        let color = expected.slice(0,6);
        const alpha = expected.slice(6,8);
        const count = expected.slice(8,10);
        if (alpha == "00") color = duck.backgroundColor.slice(2,8);
        expected = color + count;
        if (actual != expected) throw `Expected ${expected}, found ${actual}`;
    }
    if (i < palette.length) throw `Expected ${palette.length-i} more colors`;
})();

(function testBinarySearch() {
    // Test empty array
    if (-1 != binarySearch([], 0, (a,b)=>0)) throw "Expected -1 for empty array";

    // Test an item not in the array
    if (-1 != binarySearch([1,2,3,4,5], 0, (a,b)=>a-b)) throw "Expected -1 for not found";

    // Test searching for the closest element
    if (0 != binarySearch([1,2,3,4], 0, (a,b)=>a-b, true)) throw "Expected 0";
    if (1 != binarySearch([1,2,3,4], 2, (a,b)=>a-b, true)) throw "Expected 1";
    if (3 != binarySearch([1,2,3,4], 4, (a,b)=>a-b, true)) throw "Expected 2";

    // Test null array
    var ex = null;
    try { binarySearch(null, 0, (a,b)=>0) }
    catch(e) { ex = e }
    if (ex == null) throw "Expected exception for null array";

    // Test null compare function
    ex = null;
    try { binarySearch([0], 0, null) }
    catch(e) { ex = e }
    if (ex == null) throw "Expected exception for null compare function";

    for (var i=0; i < 10000; i++) {
        // Generate a sorted array of random length with random elements
        var len = random(1,1000);
        var array = [];
        for (var j=0; j < len; j++){
            array.push(random(0,1000))
        }
        array.sort((a,b) => a-b);

        // Generate a random item and binary search for it
        var item = random(0,1000);
        var closest = binarySearch(array, item, (a,b) => a-b, true);

        // Find the actual closest(s) items with a linear search
        var actualClosest = [[], Number.MAX_VALUE];
        for (var j=0; j < array.length; j++){
            var abs = Math.abs(array[j] - item);
            if (abs == actualClosest[1]) {
                actualClosest[0].push(j);
            } else if (abs < actualClosest[1]) {
                actualClosest = [[j],abs];
            }
        }
        if (!actualClosest[0].includes(closest)) {
            throw `Expected ${closest} in ${actualClosest[0].join(",")}`;
        }
    }
})();

(function testSortedArray() {

    // Test null compare function
    try {
        new SortedArray(null, len);
        throw "Expected exception";
    } catch { }

    // Test limit < 1
    try {
        new SortedArray((a,b)=>0, 0);
        throw "Expected exception";
    } catch { }

    // Compares numbers
    function compare(a,b) {
        if (a == null || b == null) throw "Unexpected null in compare";
        return a-b;
    };

    // Returns true if the arrays are equal
    function equal(a,b) {
        if (a.length != b.length) return false;
        for (var i=0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }

    for (var i=0; i < 1000; i++) {
        // Create an array with a random length limit
        var limit = random(1,500);
        if (limit % 100 == 99) limit = null; // Don't limit the length sometimes
        var sorted = new SortedArray(compare, limit);
        var array = [];

        // Fill it with random items
        for (var j=0; j < 500; j++) {
            var item = random(0,500);
            sorted.add(item);
            array.push(item);

            // Verify that the the sort order and limit are maintained
            array.sort((a,b)=>a-b);
            if (limit != null) array.splice(limit);
            if(!equal(sorted.array, array)) throw "Array not sorted and limited";
        }
    }
})();

/** Returns a random integer from inclusive {min} to inclusive {max} */
function random(min,max) { return Math.floor(Math.random()*(max-min+1)) + min }
