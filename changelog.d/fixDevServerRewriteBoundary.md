### 🐞 Bug Fixes

* The dev server now sends a path to an app's `index.html` only if it is that app's path or below
  it. Before, an app such as `portfolio` also took `/portfolioBlueprints/...`, so that app loaded
  the wrong page.
* The dev server now proxies only the API path and the paths below it to the Grails server, such as
  `/api` and `/api/...`. Before, it also proxied any app whose name began with `api`, such as
  `/apiDocs`.
