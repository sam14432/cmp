import { encodeVendorConsentData, decodeVendorConsentData } from "./cookie/cookie";
import { fetchGlobalVendorList, fetchPubVendorList } from "./vendor";
import Promise from 'promise-polyfill';
import log from './log';

const DEFAULT_CONFIG = {
	cmpConfig: {
		"customPurposeListLocation": "./purposes.json",
		"globalVendorListLocation": "https://vendorlist.consensu.org/vendorlist.json",
		//"globalConsentLocation": "//acdn.adnxs.com/cmp/docs/portal.html",
		//"globalConsentLocation": "//samuelapi.relevant-digital.com:5000/docs/portal.html",
		"storeConsentGlobally": false,
		"storePublisherData": false,
		"logging": "warn",
		"localization": {},
		"forceLocale": null,
		"gdprApplies": true,
	},
	pubVendorList: undefined,
	manageButtonStyle: 'default',
	useBuiltInVendorList: true,
};

let consent, allVendorConsents, waiters = [], onConsentListeners = {};

const waitConsent = (fn) => consent ? fn() : waiters.push(fn);

const inject = (obj, fnName, fn) => {
	let realCall;
	Object.defineProperty(obj, fnName, {
		get: () => ((...args) => {
			waitConsent((wasWaiting) => fn(realCall, wasWaiting,...args));
		}),
		set: (orgFn) => {
			realCall = orgFn;
		},
	});
};

class Relevant
{
	static mergeLocalization(locMap) {
		const special = Relevant.config.specialLocalization || {};
		for (let lang in special) {
			Object.assign((locMap[lang] = locMap[lang] || {}), special[lang]);
		}
		return locMap;
	}

	static mergeWithCustomVendors(globalVendorList)	{
		const mergedWith = (vendorList, other) => {
			return Object.assign({}, vendorList, {
				vendors: (vendorList.vendors || []).concat(other.vendors || []),
				vendorListVersion: (vendorList.vendorListVersion || 0) + (other.vendorListVersion || 0),
			});
		};
		const fullList = mergedWith(mergedWith(globalVendorList, Relevant.VENDOR_LIST), Relevant.config.customVendors || {});
		(fullList.vendors || []).forEach((vendor) => {
			if (vendor.onConsent) {
				onConsentListeners[vendor.id] = vendor.onConsent;
				delete vendor.onConsent;
			}
		});
		return fullList;
	}

	static fetchGlobalVendorList() {
		const builtInList = window.__globalVendorList
		if (Relevant.config.useBuiltInVendorList && builtInList) {
			return Promise.resolve(Relevant.mergeWithCustomVendors(builtInList));
		}
		return fetchGlobalVendorList().then(Relevant.mergeWithCustomVendors);
	}

	static fetchPubVendorList() {
		if ('pubVendorList' in Relevant.config) {
			return Promise.resolve(Relevant.config.pubVendorList);
		}
		return fetchPubVendorList();
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
		inject(sas, 'call', (orgFn, wasWaiting, type, obj, ...rest) => {
			obj = Object.assign({}, obj, {
				gdpr_consent: consent,
			});
			orgFn.call(sas, type, obj, ...rest);
		});
		inject(sas, 'setup', (orgFn, wasWaiting, obj, ...rest) => {
			if (wasWaiting) {
				obj = Object.assign({}, obj || {}, {
					async: true,
				});
			}
			log.debug(`sas.setup(async = ${!!obj.async})`);
			orgFn.call(sas, obj, ...rest);
		});
		inject(sas, 'render', (orgFn, wasWaiting, ...rest) => {
			orgFn.call(sas, ...rest);
		});
	}

	static init() {
		const localConfig = window.RELEVANT_CMP_CONFIG || {};
		const config = Object.assign({}, DEFAULT_CONFIG, localConfig);
		config.cmpConfig = Object.assign({}, DEFAULT_CONFIG.cmpConfig, localConfig.cmpConfig || {});
		Relevant.config = config;

		window.__cmp = { config: config.cmpConfig };

		Promise._immediateFn = (fn) => {
			fn();
		};

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

	static transferConsentFromEnsighten(mapping) {
		const MAX_PURPOSE_ID = 10;
		const { store } = Relevant.cmpObj;
		if (!mapping) {
			return;
		}
		const enConsents = {};
		document.cookie.split(';').forEach((cookieStr) => {
			const parts = cookieStr.split('=');
			if (parts[0] && ~parts[0].indexOf('__ENSIGHTEN_PRIVACY_') && parts[1]) {
				const key = (/_ENSIGHTEN_PRIVACY_(.*)/.exec(parts[0]) || [])[1];
				if (key) {
					enConsents[key] = !!parseInt(parts[1]);
				}
			}
		});
		const purposeConsents = {};
		for (var enKey in mapping) {
			(mapping[enKey].purposes || []).forEach((purposeId) => {
				if (enConsents[enKey]) {
					purposeConsents[purposeId] = true;
				}
			});
		}
		for (var purposeId = 1; purposeId <= MAX_PURPOSE_ID; purposeId++) {
			store.selectPurpose(purposeId, !!purposeConsents[purposeId]);
		}
		store.vendorList.vendors.forEach((vendor) => {
			const hasConsent = !(vendor.purposeIds || []).find(pId => !purposeConsents[pId]);
			store.selectVendor(vendor.id, hasConsent);
		});
		store.persist();
	}

	static onCmpCreated(cmpObj)
	{
		Relevant.cmpObj = cmpObj;
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
			showConsentTool: (parameter, callback) => {
				if (Relevant.config.hideUi && !parameter) {
					log.debug(`Not showing UI due to config`);
				} else {
					orgFn('showConsentTool', parameter, callback);
				}
			},
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
		relevantCmp.isRelevantCmp = true;

		Relevant.transferConsentFromEnsighten(Relevant.config.ensightenMapping);
		window.__cmp = relevantCmp;
		relevantCmp('getConsentData', null, (consentRes) => {
			relevantCmp('relevant_getVendorConsents', null, (vendorConsents) => {
				allVendorConsents = vendorConsents;
				consent = consentRes;
				Relevant.notifyConsentListeners();
				waiters.forEach(fn => fn(true));
				waiters = null;
			});
		});
	}

	static notifyConsentListeners() {
		for (const [vendorId, cb] of Object.entries(onConsentListeners)) {
			const hasConsent = allVendorConsents.vendorConsents[vendorId];
			cb(hasConsent);
		}
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
			featureIds: [ 1, 2 ],
			onConsent: (hasConsent) => {
				const gtag = (window.googletag = window.googletag || {});
				(gtag.cmd = gtag.cmd || []).push(() => {
					gtag.pubads().setRequestNonPersonalizedAds(hasConsent ? 0 : 1);
				});

			},
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
