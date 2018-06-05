# Relevant fork of Appnexus CMP

This fork contains some custom functionality for supporting "non IAB vendors" + custom UI behavior. We'll keep it synced with the official/upstream project whenever we deem the official changes appropriate.

### Sample usage with explanations

```html
<!-- Place in <head> BEFORE including adserver js -->
<script>
RELEVANT_CMP_CONFIG = {
	// "Own" vendors that should be added to the consent-list, use IDs >= 6000
	customVendors: { 
	
           // update whenever you change the list (will cause new popup)	
           vendorListVersion: 1,
           vendors: [
               {
                   id: 6001,
                   name: 'Facebook',
                   policyUrl: 'https://www.facebook.com/policy.php',
                   purposeIds: [ 1 ],
                   legIntPurposeIds: [ 2, 3, 4, 5 ],
                   featureIds: [ 1, 2 ]
               },
               {
                   id: 6002,
                   name: 'Some other vendor not part of the global vendor list',
                   policyUrl: 'https://www.someothervendor.com/privacy-policy/',
                   purposeIds: [ 1 ],
                   legIntPurposeIds: [ 2, 3, 4, 5 ],
                   featureIds: [ 1, 2 ]
               },
           ],
	},
	// true => use vendor-list included in cmp.complete.vendors.bundle.js
	useBuiltInVendorList: true,
	
	// 'hidden' => hide "manage choices" option, 'full' => big manage choices button
	manageButtonStyle: 'default',

	// true => don't show a "manage your settings" bottom-bar after accepting consent
	hideBottomBar: true, 

	// set to undefined to NOT try to fetch '/.well-known/pubvendors.json'
	pubVendorList: undefined,

	/**
	* Will "merge" custom translation strings into the normal translations:
	* https://github.com/sam14432/cmp/blob/master/src/lib/translations.js
	* This is useful if you want to customize some but not all of the UI
	* text.
	*/
	specialLocalization: {
		fi: {
			"intro.title": "Some custom title",
			"intro.acceptAll": "My Accept button text",
		},
	},
	/**
	* The "normal" Appnexus CMP config object, see this:
	* https://github.com/sam14432/cmp/blob/master/src/lib/config.js
	*/    
	cmpConfig: {
		// Remove to set "warn" as log-level (default). "debug" will show a lot of info
		logging: "debug",

		// UI language
		forceLocale: 'fi',
	},
};
</script>

<!-- Example URL - use latest version of script -->
<script src="//cdn.relevant-digital.com/cmp/cmp.complete.vendors.bundle.js"></script>

<!--
	Example on how to optionally record consent per user somehow.
	(Probably by fetching some own URL)
	There will be a callback to the inner function whenever the user have "accepted"
	the UI (so only when the popup has been shown)
-->
<script>
	__cmp('addEventListener', 'onSubmit', function() {
		__cmp('relevant_getVendorConsents', null, function(consents) {
			console.info("Record consent string + user somewhere: " + consents.metadata);
		});
	});
</script>

```

### Faster page loads by using stub + async loading

You can use the lightweight "stub" loader in order to load the full CMP library using the **async** attribute. Below is an example of a tag using this format (with default settings):

```html
<!-- Place in <head> BEFORE including adserver js -->
<script src="//cdn.relevant-digital.com/cmp/stub.js"></script>

<!-- Place anywhere below on page -->
<script src="//cdn.relevant-digital.com/cmp/cmp.complete.vendors.bundle.js" async></script>
```

In order to further improve the page load performance it is also acceptable to copy the content of  https://cdn.relevant-digital.com/cmp/stub.js and place it inside a script tag that *replaces* the external script reference to stub.js.

**WARNING:*** Loading the library this way will inactivate the following config settings. *If you don't use any of these you can ignore this warning*.

- **injectInSmartTags**
- **deferDfpLoading**
- **syncCxenseConsent**

### Configuration with Ensighten Privacy

If you use Ensighten Privacy you probably don't want to expose an additional UI. Instead it's possible to map the selected consent categories you've created in Ensighten to the 5 IAB *purposes* defined [here](https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/Consent%20string%20and%20vendor%20list%20formats%20v1.1%20Final.md). This mapping is also used to filter out the IAB vendor IDs that consent will be given to.

> Ensighten will enforce the consent on the page, blocking all request to vendors lacking that from the user. That might lead to the conclusion that all IAB vendors/consent could safely be selected as all requests to the non-approved vendors will anyway be blocked on the page. However, the IAB consent string will also be used by servers (for example between a SSP there is consent for to a DSP lacking consent). That is the reason this mapping is used.

An example tag, if you have specified four consent categories "Advertising", "Analytics", etc - would look like below:

```html
<!-- Place in <head> BEFORE including any adserver .js -->
<script>
RELEVANT_CMP_CONFIG = {
    
    /**
    * Map Ensighten category names (keys) to IAB purpose IDs.
    * Overlaps are allowed (the same IAB purpose ID can occur > 1 time)
    */
	ensightenMapping: {
		"Advertising": {
			purposes: [3],
		},
		"Analytics": {
			purposes: [5],
		},
		"Performance and Functionality": {
			purposes: [1, 2, 4],
		},
		"Social Media": {
			purposes: [],
		},
	},
    
    /**
    * If legitimateInterest is 'hard', then there must be consent for all
    * purposes listed in the list of "legitimate interest" purposes for a vendor. 
    */
	legitimateInterest: 'hard',
	
    /**
    * Hide the UI, you want do to that.
    * The UI can be shown by "force" via a javascript call: __cmp('showConsentTool', true)
    */
    hideUi: true,
};
</script>
<script src="//cdn.rawgit.com/sam14432/cmp/master/dist/cmp.complete.vendors.bundle.js"></script>
```

> **First time page load (when the Ensighten UI is shown)**
>
> Currently this will result in no IAB consent at all. This is because the code will read the cookies created by Ensighten upon loading the page, *before* the user have the change to press the "ok" button.

### Using own/custom way to signal consent

There might be situations where you have obtained consent/non-consent for a number of of vendors and/or purposes in a customized way (for example via an own UI) . In this case it's possible to store this information in the CMP and bypass the normal UI.

You can do that by implementing a function **customConsentFn(vendorList, callback)**. This function is expected to call the **callback** function with an object on this format (or **undefined**/**null** which has no effect):

```javascript
{
    vendors: [/** Array of vendor-ids OR object of { id: boolean } */],
    purposes: [/** Array of purpose-ids OR object of { id: boolean } */],
    features: [/** Array of feature-ids OR object of { id: boolean } (NOT IN USE) */],
}
```

An example config with a **customConsentFn** that gives consent to all IDs would look like this:

**WARNING:** *This is an example for documentation-purpose only, using such "accept all" policy is not compatible with GDPR or the IAB framework's usage policies.*

```html
<script>
RELEVANT_CMP_CONFIG = {
	...
	hideUi: true,
	customConsentFn: function(vendorList, callback) {
		callback({
			vendors: vendorList.vendors.map(function(v) { return v.id; }),
			purposes: vendorList.purposes.map(function(p) { return p.id; }),
			features: vendorList.features.map(function(f) { return f.id; }),
		});
	},
	...
};
</script>
```

Similarly, a configuration that would give consent to nothing would look like this:

```html
<script>
RELEVANT_CMP_CONFIG = {
	...
	hideUi: true,
	customConsentFn: function(vendorList, callback) {
    	callback({ 
			vendors: [],
			purposes: [],
			features: [],
		});
	},
	...
};
</script>
```

Use objects instead of arrays when you only want to change *some* of the consent settings. The following configuration **1)** sets consent for one vendor **2)** non-consent for another **3)** consent for one purpose **4)** keeps all other consent settings intact.

```javascript
<script>
RELEVANT_CMP_CONFIG = {
	...
	hideUi: true,
	customConsentFn: function(vendorList, callback) {
		callback({ 
			vendors: {
				8: true,
				12: false,
			},
			purposes: {
				3: true,
			},
		});
	},
	...
};
</script>
```

### Configuration with Cxense

Cxense is added as custom vendor 5002. It is possible to automate [Cxense's consent settings](https://wiki.cxense.com/display/cust/GDPR+Compliance+with+Cxense) by using **syncCxenseConsent: true** in the configuration. By enabling that setting "page view events", etc - are delayed until consent has been given to Cxense for the corresponding purposes. Below is an example tag showing how this can be done.

```html
<!-- Place in <head> BEFORE including any adserver .js -->
<script>
RELEVANT_CMP_CONFIG = {
	/** This will set Cxense's consent setting from the settings in Appnexus CMP */
    syncCxenseConsent: true,
};
</script>
<script src="//cdn.rawgit.com/sam14432/cmp/master/dist/cmp.complete.vendors.bundle.js"></script>
```

As Cxense and IAB are defining the purposes for the consents somewhat differently, the following mapping is used.

| Cxense Purpose | IAB Purpose IDs |
| -------------- | --------------- |
| pv             | 1, 2, 5         |
| recs           | 4               |
| segments       | 1, 2, 5         |
| ad             | 3               |

This means for example that page view events "pv" is only sent if the user have given consent to IAB purposes 1, 2, *and* 5 in the CMP.

### Show Google DFP ads based upon user consent

> **NOTICE:** This section depends upon the config setting **useCustomGoogle** that must be set to **true**. Without it 'Google' is not added as a custom vendor.

At the time of writing (**2018-05-28**) Google is not *yet* part of IAB's framework. Instead Google is added as a custom vendor with id 5000 (see an explanation of "custom vendors" later in this document).

However *this will very soon change*, as Google is implementing support for the IAB framework:

https://support.google.com/dfp_premium/answer/9031024#iabframework

But to use this custom solution to *avoid* loading DFP ads when there is no consent for that (not consent to Google + or IAB purposes 1+3), and to avoid load personalized ads (when IAB purpose 2 is missing), you can use a tag like below that follows the procedures described here:

https://support.google.com/dfp_premium/answer/7678538

```html
<!-- Place in <head> BEFORE including any adserver .js -->
<script src="//cdn.rawgit.com/sam14432/cmp/master/dist/cmp.complete.vendors.bundle.js"></script>
<script>
googletag = window.googletag || {};
(googletag.cmd = googletag.cmd || []).push(function() {
	var pubads = googletag.pubads();
    
	// Don't request any ads until we know if there is consent    
	pubads.disableInitialLoad();
	__cmp('relevant_getVendorConsents', null, function(consents) {

		// Google is currently custom vendor 5000        
		var hasGoogleConsent = consents.vendorConsents[5000];

		var purposes = consents.purposeConsents;
		if(!hasGoogleConsent || !purposes[1] || !purposes[3]) {
			// Don't show any ads without consent to Google + purposes:
			// "Information storage and access" and "Ad selection, delivery, reporting"
			return;
		}

		// ONLY request ads if there is consent to purpose "Personalisation"		
		pubads.setRequestNonPersonalizedAds(purposes[2] ? 0 : 1);
		pubads.refresh(); // finally, request ads
	});
});
</script>
```

#### Alternative solution

The same procedure can also be triggered by enabling the config settings **initDfpPersonalization** and **deferDfpLoading**. See below.

**NOTICE:** Also remember to check your own implementation, as **googletag.pubads().refresh()** calls (see above) might already be made, causing ad-requests to be triggered without consent.

```js
<!-- Place in <head> BEFORE including any adserver .js -->
<script>
RELEVANT_CMP_CONFIG = {
    useCustomGoogle: true,	
    
    /**
    * Will call googletag.pubads().setRequestNonPersonalizedAds([0 or 1]),
    * after loading consent settings.
    */
    initDfpPersonalization: true,
	
    /**
    * If true, will call disableInitialLoad() on initialization
    * and refresh() after loading consent - if the there is suffient consent.
    * WARNING: will prevent ads to be shown if enableSyncRendering() is used 
    * and they are requested before consent has been loaded. See:
    * https://support.google.com/dfp_premium/answer/7678538
    */
    deferDfpLoading: false,    
};
</script>
<script src="//cdn.relevant-digital.com/cmp/cmp.complete.vendors.bundle.js"></script>
```

### Global consent

*Don't* try to edit the config to enable it - currently it doesn't work as it should.

### Extensions to the IAB framework to handle custom vendors

We have the option to add "custom vendors" both in the CMP fork ourselves and by the publisher on the site. This is done in two ways:

- Adding vendors to **Relevant.VENDOR_LIST** here https://github.com/sam14432/cmp/blob/master/src/lib/relevant.js (starting from id: 5000). This should be done by Relevant.
- Adding vendors using the **customVendors** config option as shown in the example above (starting from id 6000). This should be done by the Publisher.

The purpose is to make it possible use the same consent UI (Appnexus CMP) to also give consent to vendors not yet part of the IAB framework.

In order to not cause unexpected behavior when other systems receives the consent strings etc containing these "high" id numbers, there are 2 versions of the following IAB commands where the versions prefixed by "relevant_" (**Relevant command**) includes data about the custom vendors while the standard versions (**Default command**) don't. 

| Default command   | Relevant command           |
| ----------------- | -------------------------- |
| getVendorList     | relevant_getVendorList     |
| getConsentData    | relevant_getConsentData    |
| getVendorConsents | relevant_getVendorConsents |

So, here's an example on how to check for consent of all vendors (including the custom vendors) and then take actions based upon that ("Facebook" that has id 6001 if using the example config above):

```
__cmp('relevant_getVendorConsents', null, function(consents) {
      if(consents.vendorConsents[6001]) {
         // We have consent for facebook, let's do something
      }
   }
});
```

### Building your own version

Clone this repository using e.g. 

```
git clone git@github.com:sam14432/cmp.git
```

Then follow the rest of the build documentation here: https://github.com/sam14432/cmp 
