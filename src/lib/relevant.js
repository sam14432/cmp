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

let consent, waiters = [];

class Relevant
{
	static mergeWithCustomVendors(vendorList)
	{
		return Object.assign(vendorList, {
			vendors: (vendorList.vendors || []).concat(Relevant.CUSTOM_VENDORS),
			vendorListVersion: (vendorList.vendorListVersion || 0) + Relevant.VENDOR_LIST_VERSION,
		});
	}

	static waitBody(param)
	{
		return new Promise((resolve, reject) => {
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

	static init()
	{
		const localConfig = window.RELEVANT_CMP_CONFIG || {};
		const config = Object.assign({}, DEFAULT_CONFIG, localConfig);
		config.cmpConfig = Object.assign({}, DEFAULT_CONFIG.cmpConfig, localConfig.cmpConfig || {});

		window.__cmp = { config: config.cmpConfig };

		const sas = (window.sas = window.sas || {});

		const waitConsent = (fn) => consent ? fn() : waiters.push(fn);

		const inject = (obj, fnName, fn) => {
			let realCall;
			Object.defineProperty(sas, fnName, {
				get: () => ((...args) => {
					waitConsent(() => fn(realCall, ...args));
				}),
				set: (orgFn) => {
					realCall = orgFn;
				},
			});
		};

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

	static onCmpCreated(cmp)
	{
		cmp('getConsentData', null, (result) => {
			//document.write = document.writeln = () => {debugger;};
			consent = result;
			waiters.forEach(fn => fn());
			waiters = null;
		});
	}
}

Relevant.VENDOR_LIST_VERSION = 1;

Relevant.CUSTOM_VENDOR_START_ID = 5000;

Relevant.CUSTOM_VENDORS = [
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
];


export default Relevant;
