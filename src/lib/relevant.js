import {
	encodeVendorConsentData,
	decodeVendorConsentData,
	readCookie,
	writeCookie
} from "./cookie/cookie";
import { fetchGlobalVendorList, fetchPubVendorList } from "./vendor";
import Promise from 'promise-polyfill';
import log from './log';

const MAX_PURPOSE_ID = 5;

let CXENSE_VENDOR_ID;

const STRING_ENC_OFS = 64;
const KNOWN_VENDORS_COOKIE = "rlv_vendors";

const CXENSE_PURPOSE_MAPPING = {
	pv: [1,2,5],
	recs: [4],
	segments: [1,2,5],
	ad: [3],
};

const START_TIME = new Date();

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
	legitimateInterest: 'hard',
	injectInSmartTags: false,
	syncCxenseConsent: false,
	initDfpPersonalization: false,
	deferDfpLoading: false,
};

let consent, allVendorConsents, waiters = [];

const vendorListeners = {
	onConsent: {},
	onSubmit: {},
};

const consentStringEq = (str1, str2) => {
	const now = new Date();
	if (!str1 || !str2) {
		return !str1 === !str2;
	}
	const normalize = (str) => {
		const obj = decodeVendorConsentData(str);
		obj.lastUpdated = now;
		return encodeVendorConsentData(obj);
	};
	return normalize(str1) === normalize(str2);
};

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

const googleQueue = (fn) => {
	const gtag = (window.googletag = window.googletag || {});
	(gtag.cmd = gtag.cmd || []).push(() => {
		fn(gtag);
	});
}

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
			for (const key of Object.keys(vendorListeners)) {
				if (vendor[key]) {
					if (!vendorListeners[key][vendor.id]) {
						vendorListeners[key][vendor.id] = vendor[key];
					}
					delete vendor[key];
				}
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

	static injectDfpTags() {
		googleQueue((gtag) => {
			gtag.pubads().disableInitialLoad();
		});
	}

	static injectSmartTags() {
		if (window.sas) {
			log.error('CMP must be loaded before smart.js and not using async');
		}
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

	static injectCxense() {
		const cX = (window.cX = window.cX || {});
		(cX.callQueue = cX.callQueue || []).push(['requireConsent']);
		cX.callQueue.push(['invoke', () => {
			const consObj = {};
			for (const cxName of Object.keys(CXENSE_PURPOSE_MAPPING)) {
				consObj[cxName] = false;
			}
			cX.setConsent(consObj); // start by giving no consent
		}]);
	}

	static syncCxenseConsent() {
		if (!Relevant.config.syncCxenseConsent) {
			return;
		}
		log.debug("Syncing consent to Cxense");
		const cX = window.cX, consObj = {};
		const hasConsent = allVendorConsents.vendorConsents[CXENSE_VENDOR_ID];
		const { purposeConsents = {} } = allVendorConsents;
		for (const [cxName, purposeIds] of Object.entries(CXENSE_PURPOSE_MAPPING)) {
			consObj[cxName] = hasConsent && !(purposeIds).find(pId => !purposeConsents[pId]);
		}
		cX.callQueue.push(['invoke', () => {
			cX.setConsent(consObj, { runCallQueue: hasConsent });
		}]);
	}

	static init() {
		const localConfig = window.RELEVANT_CMP_CONFIG || {};
		const config = Object.assign({}, DEFAULT_CONFIG, localConfig);
		config.cmpConfig = Object.assign({}, DEFAULT_CONFIG.cmpConfig, localConfig.cmpConfig || {});
		Relevant.config = config;
		if (config.cmpConfig.storeConsentGlobally) {
			log.error('Global consent currently not supported, falling back to local consent');
			config.cmpConfig.storeConsentGlobally = false;
		}

		window.__cmp = { config: config.cmpConfig };

		Promise._immediateFn = (fn) => {
			fn();
		};

		if (config.injectInSmartTags) {
			Relevant.injectSmartTags();
		}
		if (config.deferDfpLoading) {
			Relevant.injectDfpTags();
		}
		if (config.syncCxenseConsent) {
			Relevant.injectCxense();
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

	/** Map consent from Ensighten cookies and save it */
	static transferConsentFromEnsighten(mapping) {
		const { cmpObj } = Relevant;
		const { store } = cmpObj;
		if (!mapping) {
			return;
		}
		const consentStr = cmpObj.generateConsentString();
		const enConsents = {};
		document.cookie.split(';').forEach((cookieStr) => {
			const parts = cookieStr.split('=');
			if (parts[0] && ~parts[0].indexOf('_ENSIGHTEN_PRIVACY_') && parts[1]) {
				const key = (/_ENSIGHTEN_PRIVACY_(.*)/.exec(parts[0]) || [])[1];
				if (key) {
					enConsents[key] = !!parseInt(parts[1]);
				}
			}
		});
		const purposeConsents = {};
		for (const [enKey, settings] of Object.entries(mapping)) {
			(settings.purposes || []).forEach((purposeId) => {
				if (enConsents[enKey]) {
					purposeConsents[purposeId] = true;
				}
			});
		}
		for (let purposeId = 1; purposeId <= MAX_PURPOSE_ID; purposeId++) {
			store.selectPurpose(purposeId, !!purposeConsents[purposeId]);
		}
		store.vendorList.vendors.forEach((vendor) => {
			let hasConsent = !(vendor.purposeIds || []).find(pId => !purposeConsents[pId]);
			if (hasConsent && Relevant.config.legitimateInterest === 'hard' && (vendor.legIntPurposeIds || []).find(pId => !purposeConsents[pId])) {
				hasConsent = false;
			}
			store.selectVendor(vendor.id, hasConsent);
		});
		store.persist();
		if (!consentStringEq(consentStr, Relevant.cmpObj.generateConsentString())) {
			setTimeout(() => cmpObj.notify('onSubmit'));
		}
	}

	static onSubmit() {
		for (const cb of Object.values(vendorListeners.onSubmit)) {
			try {
				cb();
			} catch (e) {
				log.error(e.message);
			}
		}
		const { vendors } = Relevant.cmpObj.store.vendorList;
		let maxGlobalId = 0;
		const customIds = [];
		const globalIds = new Set();
		vendors.forEach((vendor) => {
			if (vendor.id < Relevant.CUSTOM_VENDOR_START_ID) {
				maxGlobalId = Math.max(vendor.id, maxGlobalId);
				globalIds.add(vendor.id);
			} else {
				customIds.push(vendor.id);
			}
		});
		const slots = Math.floor(maxGlobalId / 6) + 1;
		let str = "";
		for (let i = 0; i < slots; i++) {
			let num = 0;
			for (let j = 0; j < 6; j++) {
				num += (globalIds.has(i*6 + j) ? 1 : 0) << j;
			}
			str += String.fromCharCode(STRING_ENC_OFS + num);
		}
		writeCookie(KNOWN_VENDORS_COOKIE, JSON.stringify({ global: str, custom: customIds}), 33696000, '/');
	}

	static initNewVendors() {
		const { store } = Relevant.cmpObj;
		const { vendors } = store.vendorList;
		const knownCookie = readCookie(KNOWN_VENDORS_COOKIE);
		if (!knownCookie) {
			return;
		}
		const known = new Set();
		try {
			const obj = JSON.parse(knownCookie);
			const str = (obj.global || "");
			for (let i = 0; i < str.length; i++) {
				const num = str.charCodeAt(i);
				for (let j = 0; j < 6; j++) {
					if (num & (1 << j)) {
						known.add(i*6 + j);
					}
				}
			}
			(obj.custom || []).forEach((customId) => {
				known.add(customId);
			});
			vendors.forEach((vendor) => {
				if (!known.has(vendor.id)) {
					store.selectVendor(vendor.id, true);
				}
			});
		} catch (e) {
			console.warn(`Corrupt cookie: ${KNOWN_VENDORS_COOKIE}`);
		}
	}

	static onCmpCreated(cmpObj)
	{
		Relevant.cmpObj = cmpObj;
		const orgFn = window.__cmp;

		Relevant.initNewVendors();

		orgFn('addEventListener', 'onSubmit', Relevant.onSubmit);

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
				log.debug(`Relevant loading completed in ${Date.now() - START_TIME} ms`);
				waiters.forEach(fn => fn(true));
				waiters = null;
			});
		});
	}

	static notifyConsentListeners() {
		for (const [vendorId, cb] of Object.entries(vendorListeners.onConsent)) {
			const hasConsent = allVendorConsents.vendorConsents[vendorId];
			try {
				cb(hasConsent);
			} catch (e) {
				log.error(e.message);
			}
		}
	}
}

Relevant.CUSTOM_VENDOR_START_ID = 5000;

Relevant.VENDOR_LIST = {
	vendorListVersion: 4,
	vendors: [
		{
			id: Relevant.CUSTOM_VENDOR_START_ID + 0,
			name: 'Google LLC',
			policyUrl: 'https://policies.google.com/privacy',
			purposeIds: [ 1 ],
			legIntPurposeIds: [ 2, 3, 4, 5 ],
			featureIds: [ 1, 2 ],
			onConsent: (hasConsent) => {
				googleQueue((gtag) => {
					const pubads = gtag.pubads();
					if (Relevant.config.initDfpPersonalization) {
						pubads.setRequestNonPersonalizedAds(hasConsent ? 0 : 1);
					}
					if (Relevant.config.deferDfpLoading) {
						pubads.refresh();
					}
				});
			},
		},
		{
			id: (CXENSE_VENDOR_ID = Relevant.CUSTOM_VENDOR_START_ID + 2),
			name: 'Cxense ASA',
			policyUrl: 'https://www.cxense.com/about-us/privacy-policy/',
			purposeIds: [ 1 ],
			legIntPurposeIds: [ 2, 3, 4, 5 ],
			featureIds: [ 1, 2 ],
			onConsent: Relevant.syncCxenseConsent,
		},
	],
};

export default Relevant;
