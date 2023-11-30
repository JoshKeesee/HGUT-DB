const client = require("@jkeesee/json-db");
client.condense();

const set = (key, value) => {
	if (typeof key == "object") client.set(key);
	else client.set(key, value);
};

const get = (key) => {
	const res = client.get(key);
	return res;
};

module.exports = { get, set };