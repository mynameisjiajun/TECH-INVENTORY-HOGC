
## 2024-05-24 - Pre-compile fuzzy search terms
**Learning:** In `app/api/items/route.js`, the search string was being redundantly parsed, lowercased, split, and normalized inside the `items.filter()` loop for every single property checked (up to 5 times per item). For 1000 items, the same search query was re-computed 5000 times, causing unnecessary CPU overhead and garbage collection.
**Action:** When performing fuzzy matching or complex string comparisons inside a loop (especially `.filter()` over large datasets), hoist the invariant search query computation out of the loop using a closure (e.g., `compileFuzzySearch`). Pre-compute normalized terms, splits, and pairs once, and return a matcher function that only performs the final `includes()` checks on the iterated items.
