/*
 (c) 2013, Vladimir Agafonkin
 RBush, a JavaScript library for high-performance 2D spatial indexing of points and rectangles.
 https://github.com/mourner/rbush
*/

(function () { 'use strict';

function rbush(maxEntries, format) {
    // jshint newcap: false, validthis: true, evil: true

    if (!(this instanceof rbush)) {
        return new rbush(maxEntries, format);
    }

    if (!maxEntries) {
        throw new Error("Provide a maxEntries argument to rbush constructor");
    }
    this._maxEntries = Math.max(4, maxEntries);
    this._minFill = Math.max(2, Math.floor(this._maxEntries * 0.4));


    // customizes data format (minX, minY, maxX, maxY accessors)

    format = format || ['[0]', '[1]', '[2]', '[3]'];

    this._sortMinX = new Function('a', 'b', 'return a' + format[0] + ' > b' + format[0] + ' ? 1 : -1;');
    this._sortMinY = new Function('a', 'b', 'return a' + format[1] + ' > b' + format[1] + ' ? 1 : -1;');
    this._toBBox = new Function('a', 'return [a' + format.join(', a') + '];');
}

rbush.prototype = {

    // recursively search for objects in a given bbox
    search: function (bbox) {
        var result = [];
        this._search(bbox, this.data, result);
        return result;
    },

    // bulk load all data and recursively build the tree from stratch
    load: function (data) {
        this.data = this._build(data.slice(), 0);
        this._calcBBoxes(this.data);

        return this;
    },

    addOne: function (item) {
        var node = this._chooseSubtree(this._toBBox(item), this.data);
        // TODO reinsert, split (choose split axis, choose split index), insert
    },

    toJSON: function () {
        return this.data;
    },

    fromJSON: function (data) {
        this.data = data;
        return this;
    },

    _search: function (bbox, node, result) {

        if (!this._intersects(bbox, node.bbox)) { return; }

        var i, child,
            len = node.children.length;

        for (i = 0; i < len; i++) {
            child = node.children[i];

            if (!node.leaf) {
                this._search(bbox, child, result);
            } else if (this._intersects(bbox, this._toBBox(child))) {
                result.push(child);
            }
        }
    },

    // bulk load data with the OMT algorithm
    _build: function (items, level) {

        var node = {},
            N = items.length,
            M = this._maxEntries;

        if (N <= M) {
            node.children = items;
            node.leaf = true;
            return node;
        }

        node.children = [];

        if (!level) {
            // target number of root entries
            M = Math.ceil(N / Math.pow(M, Math.ceil(Math.log(N) / Math.log(M)) - 1));

            items.sort(this._sortMinX);
        }

        var N1 = Math.ceil(N / M) * Math.ceil(Math.sqrt(M)),
            N2 = Math.ceil(N / M),
            sortFn = level % 2 === 1 ? this._sortMinX : this._sortMinY,
            i, j, slice, sliceLen, childNode;

        // create S x S entries for the node and build from there recursively
        for (i = 0; i < N; i += N1) {
            slice = items.slice(i, i + N1).sort(sortFn);

            for (j = 0, sliceLen = slice.length; j < sliceLen; j += N2) {
                childNode = this._build(slice.slice(j, j + N2), level + 1);
                node.children.push(childNode);
            }
        }

        return node;
    },

    // recursively calculate all node bboxes in the tree
    _calcBBoxes: function (node) {

        node.bbox = [Infinity, Infinity, -Infinity, -Infinity];

        for (var i = 0, len = node.children.length, child; i < len; i++) {
            child = node.children[i];

            if (node.leaf) {
                this._extend(node.bbox, this._toBBox(child));
            } else {
                this._calcBBoxes(child);
                this._extend(node.bbox, child.bbox);
            }
        }
    },

    _chooseSubtree: function (bbox, node) {

        if (node.leaf) { return node; }

        var i, child, targetNode, area, enlargement, overlap, checkOverlap,
            minArea, minEnlargement, minOverlap,
            len = node.children.length;

        minArea = minEnlargement = minOverlap = Infinity;

        for (i = 0; i < len; i++) {
            child = node.children[i];

            child.area = this._area(child.bbox);
            child.enlargement = this._enlargedArea(bbox, child.bbox) - child.area;
            // TODO cleanup in toJSON
        }

        if (node.children[0].leaf) {
            // if node children are leaves, narrow our search to 32 rectangles with least area enlargement
            node.children.sort(this._sortEnlargement);
            len = Math.min(32, len);
            checkOverlap = true;
        }

        for (i = 0; i < len; i++) {
            child = node.children[i];

            if (checkOverlap) {
                overlap = this._overlapArea(bbox, child, node.children, len);
            }
            area = child.area;
            enlargement = child.enlargement;

            // choose entry with the least overlap enlargement
            if (checkOverlap && overlap < minOverlap) {
                minOverlap = overlap;
                minEnlargement = enlargement < minEnlargement ? enlargement : minEnlargement;
                minArea = area < minArea ? area : minArea;
                targetNode = child;

            } else if (!checkOverlap || overlap === minOverlap) {

                // otherwise choose entry with the least area enlargement
                if (enlargement < minEnlargement) {
                    minEnlargement = enlargement;
                    minArea = area < minArea ? area : minArea;
                    targetNode = child;

                } else if (enlargement === minEnlargement) {
                    // otherwise choose one with the smallest area
                    if (area < minArea) {
                        minArea = area;
                        targetNode = child;
                    }
                }
            }
        }

        return this._chooseSubtree(bbox, targetNode || child);
    },

    _sortEnlargement: function (a, b) {
        return a.enlargement > b.enlargement ? 1 : -1;
    },

    _intersects: function (bbox, bbox2) {
        return bbox2[0] <= bbox[2] &&
               bbox2[1] <= bbox[3] &&
               bbox2[2] >= bbox[0] &&
               bbox2[3] >= bbox[1];
    },

    _extend: function (bbox, bbox2) {
        bbox[0] = Math.min(bbox[0], bbox2[0]);
        bbox[1] = Math.min(bbox[1], bbox2[1]);
        bbox[2] = Math.max(bbox[2], bbox2[2]);
        bbox[3] = Math.max(bbox[3], bbox2[3]);
        return bbox;
    },

    _area: function (bbox) {
        return (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
    },

    _enlargedArea: function (bbox, bbox2) {
        return (Math.max(bbox2[2], bbox[2]) - Math.min(bbox2[0], bbox[0])) *
               (Math.max(bbox2[3], bbox[3]) - Math.min(bbox2[1], bbox[1]));
    },

    _overlapArea: function (bbox, node, nodes, len) {
        var newBox = this._extend(node.bbox.slice(), bbox);

        for (var i = 0, sum = 0, bbox2; i < len; i++) {
            if (node !== nodes[i]) {
                bbox2 = nodes[i].bbox;
                if (this._intersects(newBox, bbox2)) {
                    sum += this._intersectionArea(newBox, bbox2);
                }
            }
        }

        return sum;
    },

    _intersectionArea: function (bbox, bbox2) {
        var minX = Math.max(bbox[0], bbox2[0]),
            maxX = Math.min(bbox[2], bbox2[2]),
            minY = Math.max(bbox[1], bbox2[1]),
            maxY = Math.min(bbox[3], bbox2[3]);

        return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
    }
};

if (typeof module !== 'undefined') {
    module.exports = rbush;
} else {
    window.rbush = rbush;
}

})();
