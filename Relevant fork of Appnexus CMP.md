# Relevant fork of Appnexus CMP

This fork contains some custom functionality for supporting "non IAB vendors" + custom UI behavior. We'll keep it synced with the official/upstream project on regular basis.

### Sample usage with explanations

```html
<!-- Place in <head> BEFORE including smart.js -->
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
	
	// 'hidden' => hide "manage choices" option
	manageButtonStyle: 'default',

	// true => don't show a "manage your settings" bottom-bar after accepting consent
	hideBottomBar: true, 

	// makes sure tags are 'async' and render() is postponed until after consent
	injectInSmartTags: true,
	
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

<!-- Example URL - DON'T USE as we currently have no way to update this file -->
<script src="//akamai.smartadserver.com/diff/1976/7879268/cmp.complete.vendors.bundle.js"></script>

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



### Global consent

*Don't* try to edit the config to enable it - currently it doesn't work as it should.

### Extentions to the IAB framework to handle custom vendors

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