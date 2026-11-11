# vendor

`supabase.js` is the browser build of `@supabase/supabase-js` **2.119.0** (MIT licence, see `supabase.LICENSE`),
copied unchanged from `dist/umd/supabase.js` in the npm package. It is kept here so the app loads no code from
another server and cannot change under us. To update it: `npm pack @supabase/supabase-js@<version>`, copy the same
file over this one, and change the version above.
