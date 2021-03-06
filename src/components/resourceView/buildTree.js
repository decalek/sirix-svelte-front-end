import { sirix } from "../../sirix";
import { NodeType } from "sirix/src/info";
import Container from "./JsonNode/Container.svelte";
import Key from "./JsonNode/Key.svelte";
import Value from "./JsonNode/Value.svelte";
import DiffNode from "./JsonNode/DiffNode.svelte";

import { containerFuncReg, keyFuncReg, valueFuncReg } from "./JsonNode/functions";

export const createTree = (
  node,
  path,
  index
) => {
  let treeNode = {};
  const nodeType = node.metadata.type;
  treeNode["node"] = node;
  if (nodeType === NodeType.ARRAY || nodeType === NodeType.OBJECT) {
    treeNode["component"] = Container;
    treeNode["path"] =
      path.length === 0 && index === undefined
        ? path
        : typeof path[path.length - 1] === "string"
          ? path.concat(null)
          : path.concat(index);
    if (!Array.isArray(node.value)) {
      treeNode["child"] = [];
    } else {
      treeNode["child"] = node.value.map((obj, index) =>
        createTree(obj, treeNode["path"], index)
      );
    }
    treeNode["props"] = containerFuncReg(treeNode)
  } else if (nodeType === NodeType.OBJECT_KEY) {
    treeNode["component"] = Key;
    treeNode["path"] = path.concat(node.key);
    treeNode["child"] = createTree(node.value, treeNode["path"], undefined);
    treeNode["props"] = keyFuncReg(treeNode)
  } else {
    treeNode["component"] = Value;
    treeNode["path"] =
      typeof path[path.length - 1] === "string"
        ? path.concat(null)
        : path.concat(index);
    treeNode["props"] = valueFuncReg(treeNode)
  }
  return treeNode;
};

export const loadDiffs = (
  revision,
  otherRevision,
  dbName,
  dbType,
  resourceName,
  { nodeId = null, maxLevel = 3 }
) => {
  let first, second;
  if (otherRevision > revision) {
    (first = revision), (second = otherRevision);
  } else {
    (first = otherRevision), (second = revision);
  }
  return sirix.database(dbName, dbType).then(db => {
    return db
      .resource(resourceName)
      .diff(first, second, { nodeId, maxLevel })
      .then(diffObj => {
        return diffObj["diffs"];
      });
  });
};

export const inject = (treeNode, newNode, path, insertKey) => {
  let node = path.reduce((oldNode, key) => {
    if (key === null) {
      // if key is null, then return the `value` node of the current node.
      // this is used with OBJECT_ * _VALUE types,
      // as they don't have a key or index within the value field
      return oldNode.child;
    } else {
      // we are going to assume that if a key is specified,
      // then we are dealing with an an object or array,
      // both of which are encoded as arrays of objects
      if (typeof key === "string") {
        // we assume that if the key is a string,
        // not a number then we are dealing with an object
        return oldNode.child.find(item => item.node.key === key);
      } else {
        // the key is a number and we are dealing with an array
        return oldNode.child[key];
      }
    }
  }, treeNode);
  if (insertKey === null) {
    node.child = newNode;
    node.props.treeNode = newNode;
  } else {
    node.child[insertKey] = newNode;
    node.props.treeNode[insertKey] = newNode;
  }
  return treeNode;
};

export const injectDiffs = (treeNode, diffs, index) => {
  if (diffs.length === 0) {
    return [treeNode, diffs];
  }
  if (Array.isArray(treeNode)) {
    let arr = [];
    for (let [i, obj] of treeNode.entries()) {
      let [node, diffsShifted] = injectDiffs(obj, diffs, i);
      arr.push(node);
      diffs = diffsShifted;
    }
    treeNode = arr;
  } else {
    let diff = diffs[0];
    let diffType = Object.keys(diff)[0];
    let key =
      diffType === "insert" || "replace"
        ? diff[diffType]["insertPositionNodeKey"]
        : diffType === "update"
          ? diff[diffType]["nodeKey"]
          : diff[diffType];
    if (treeNode.props.nodeKey === key) {
      let newNode = {
        diffNode: diff,
        props: {},
        component: DiffNode,
      };
      if (diffType === "update" || diffType === "delete" || diffType === "replace") {
        //TODO
        //treeNode = treeNode["child"] = newNode;
        diffs.shift();
      } else if (diffType === "insert") {
        newNode.props.nodeKey = diff.insert.nodeKey;
        treeNode.props = { ...treeNode.props, diff: newNode };
        diffs.shift();
        [treeNode, diffs] = injectDiffs(treeNode.props.diff, diffs);
      }
      // treeNode = inject(treeNode, newNode, [null], null);
    }
    if (treeNode.child) {
      [treeNode.child, diffs] = injectDiffs(treeNode.child, diffs);
    }
  }
  return [treeNode, diffs];
};