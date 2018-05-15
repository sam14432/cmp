import { encodeVendorConsentData, decodeVendorConsentData } from "./cookie/cookie";

const DEFAULT_CONFIG = {
	cmpConfig: {
		"customPurposeListLocation": "./purposes.json",
		"globalVendorListLocation": "https://vendorlist.consensu.org/vendorlist.json",
		//"globalConsentLocation": "//acdn.adnxs.com/cmp/docs/portal.html",
		//"globalConsentLocation": "//samuelapi.relevant-digital.com:5000/docs/portal.html",
		"storeConsentGlobally": false,
		"storePublisherData": false,
		"logging": "debug",
		"localization": {},
		"forceLocale": null,
		"gdprApplies": true,
	},
};

let consent, waiters = [], config;

const waitConsent = (fn) => consent ? fn() : waiters.push(fn);

const inject = (obj, fnName, fn) => {
	let realCall;
	Object.defineProperty(obj, fnName, {
		get: () => ((...args) => {
			waitConsent(() => fn(realCall, ...args));
		}),
		set: (orgFn) => {
			realCall = orgFn;
		},
	});
};

class Relevant
{
	static mergeWithCustomVendors(globalVendorList)	{
		const mergedWith = (vendorList, other) => {
			return Object.assign({}, vendorList, {
				vendors: (vendorList.vendors || []).concat(other.vendors || []),
				vendorListVersion: (vendorList.vendorListVersion || 0) + (other.vendorListVersion || 0),
			});
		};
		return mergedWith(mergedWith(globalVendorList, Relevant.VENDOR_LIST), config.customVendors || {});
	}

	static waitBody(param) {
		return new Promise((resolve) => {
			const check = () => {
				if (document.body) {
					resolve(param);
				} else {
					setTimeout(check, 50);
				}
			};
			check();
		});
	}

	static injectSmartTags()
	{
		const sas = (window.sas = window.sas || {});
		inject(sas, 'call', (orgFn, type, obj, ...rest) => {
			obj = Object.assign({}, obj, {
				gdpr_consent: consent,
			});
			orgFn.call(sas, type, obj, ...rest);
		});
		inject(sas, 'setup', (orgFn, obj, ...rest) => {
			obj = Object.assign({}, obj || {}, {
				async: true,
			});
			orgFn.call(sas, obj, ...rest);
		});
		inject(sas, 'render', (orgFn, ...rest) => {
			orgFn.call(sas, ...rest);
		});
	}

	static init() {
		const localConfig = window.RELEVANT_CMP_CONFIG || {};
		config = Object.assign({}, DEFAULT_CONFIG, localConfig);
		config.cmpConfig = Object.assign({}, DEFAULT_CONFIG.cmpConfig, localConfig.cmpConfig || {});

		window.__cmp = { config: config.cmpConfig };

		if (config.injectInSmartTags) {
			Relevant.injectSmartTags();
		}
	}

	static convertConsentString(str) {
		if (!str) {
			return str;
		}
		const obj = decodeVendorConsentData(str);
		if (obj.selectedVendorIds instanceof Set) {
			const validIds = Array.from(obj.selectedVendorIds).filter(v => v < Relevant.CUSTOM_VENDOR_START_ID);
			obj.maxVendorId = validIds.length ? Math.max.apply(null, validIds) : 0;
			obj.selectedVendorIds = new Set(validIds);
		}
		const res = encodeVendorConsentData(obj);
		const hej = decodeVendorConsentData(res);
		console.info(hej);
		return res;
	}

	static convertVendorListResult(res) {
		if (res.vendors instanceof Array) {
			res = Object.assign({}, res, {
				vendors: res.vendors.filter(v => v.id < Relevant.CUSTOM_VENDOR_START_ID),
			});
		}
		return res;
	}

	static convertConsentDataResult(res) {
		res.consentData = Relevant.convertConsentString(res.consentData);
		return res;
	}

	static convertVendorConsentsResult(res) {
		res.metadata = Relevant.convertConsentString(res.metadata);
		if (res.vendorConsents instanceof Object) {
			let maxTrue = 0;
			for (let key in res.vendorConsents) {
				const isSet = res.vendorConsents[key];
				const asNum = parseInt(key);
				if (asNum < Relevant.CUSTOM_VENDOR_START_ID && isSet && asNum > maxTrue) {
					maxTrue = asNum;
				}
			}
			const validIds = {};
			for (let i = 1; i <= maxTrue; i++) {
				validIds[i] = res.vendorConsents[i];
			}
			res.vendorConsents = validIds;
			res.maxVendorId = maxTrue;
		}
		return res;
	}

	static onCmpCreated()
	{
		const orgFn = window.__cmp;

		const commands = {
			getVendorList: (parameter, callback) => orgFn('getVendorList', parameter, (result, success) => {
				callback(Relevant.convertVendorListResult(result || {}), success);
			}),
			relevant_getVendorList: (parameter, callback) => orgFn('getVendorList', parameter, callback),
			getConsentData: (parameter, callback) => orgFn('getConsentData', parameter, (result, success) => {
				callback(Relevant.convertConsentDataResult(result || {}), success);
			}),
			relevant_getConsentData: (parameter, callback) => orgFn('getConsentData', parameter, callback),
			getVendorConsents: (parameter, callback) => orgFn('getVendorConsents', parameter, (result, success) => {
				callback(Relevant.convertVendorConsentsResult(result || {}), success);
			}),
			relevant_getVendorConsents: (parameter, callback) => orgFn('getVendorConsents', parameter, callback),
		};

		const relevantCmp = (command, parameter, callback) =>
			commands[command] ? commands[command](parameter, callback) : orgFn(command, parameter, callback);

		relevantCmp.receiveMessage = ({data, origin, source}) => {
			const {__cmpCall: cmp} = data;
			if (cmp) {
				const {callId, command, parameter} = cmp;
				relevantCmp(command, parameter, returnValue =>
					source.postMessage({__cmpReturn: {callId, command, returnValue}}, origin));
			}
		};

		window.__cmp = relevantCmp;
		window.__cmp('getConsentData', null, (result) => {
			//document.write = document.writeln = () => {debugger;};
			consent = result;
			waiters.forEach(fn => fn());
			waiters = null;
		});
	}
}

Relevant.CUSTOM_VENDOR_START_ID = 5000;

Relevant.VENDOR_LIST = {
	vendorListVersion: 1,
	vendors: [
		{
			id: Relevant.CUSTOM_VENDOR_START_ID + 0,
			name: 'Google LLC',
			policyUrl: 'https://policies.google.com/privacy',
			purposeIds: [ 1 ],
			legIntPurposeIds: [ 2, 3, 4, 5 ],
			featureIds: [ 1, 2 ]
		},
		{
			id: Relevant.CUSTOM_VENDOR_START_ID + 1,
			name: 'Improve Digital B.V.',
			policyUrl: 'https://www.improvedigital.com/privacy-policy/',
			purposeIds: [ 1 ],
			legIntPurposeIds: [ 2, 3, 4, 5 ],
			featureIds: [ 1, 2 ]
		},
	],
};

export default Relevant;
