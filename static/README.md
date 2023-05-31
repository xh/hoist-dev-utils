# Build-related files

Hoist Dev Utils (`@xh/hoist-dev-utils`, aka HDU) references the files in this directory from
within its `configureWebpack()` build script factory.

* `requiredBlueprintIcons.js` - included by HDU >= v5.2 as a (very) streamlined replacement for the
  full set of Blueprint JS icons otherwise required by that library. See the comment at the top of
  the file for additional details and links.
