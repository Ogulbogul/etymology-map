# Etymology Map

A static word-etymology explorer with a world map. Type a word, hit Trace, and see
the chain of languages it passed through, plotted as pins connected by arrows on
a real world coastline map.

## Run it locally

No build step, no dependencies to install. From this folder, start any static
file server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser. (A plain `file://` open won't
work — the browser blocks the app's `fetch()` calls from local files, so it has
to be served over HTTP.)

## Files

- `index.html`, `word.html`, `style.css`, `app.js`, `word.js` — the app
- `data/words/<word>.json` — one file per word, its full stop-by-stop journey
- `data/words-index.json` — a lightweight word -> origin-language map covering
  every word, used for search/autocomplete/word-list/related-words so those
  features don't have to fetch every word's full data
- `new_word_template.json` — a blank entry to copy when adding a word by hand
- `add_word.py` — a helper script that validates new entries, writes each to
  its own file under `data/words/`, and regenerates `data/words-index.json`

Each word's full journey lives in its own small file (`data/words/coffee.json`,
for example) rather than one giant dataset, so a single word's page only ever
downloads that one word instead of the whole collection — this is what keeps
things fast as the collection grows into the thousands.

## Adding more words

1. Copy `new_word_template.json` to a new file, e.g. `my_words.json`, and fill in
   one or more words in the same shape:

   ```json
   {
     "banoffee": {
       "stops": [
         { "word": "banana", "lang": "...", "era": "...", "note": "...", "meaning": "...", "lat": 0, "lon": 0 },
         { "word": "toffee", "lang": "...", "era": "...", "note": "...", "meaning": "...", "lat": 0, "lon": 0 }
       ],
       "current_meaning": "..."
     }
   }
   ```

2. Run:

   ```bash
   python3 add_word.py my_words.json
   ```

   This checks each entry (at least 2 stops, all required fields present,
   lat/lon in range, a current_meaning set), writes each word to its own file
   under `data/words/` (overwriting any existing word of the same name), and
   regenerates `data/words-index.json` from every file in that folder.

3. Refresh the page — no restart needed since it's static.

You (or I, in a future session) can batch-add many words at once by putting
several entries in one file and running the script once.

### Field notes

- `lat` / `lon` should be the real-world approximate coordinates of where that
  stage of the word's history took place (a capital city or region is fine).
- `era` is a short free-text string like `"c. 1500s"` or `"1920"`.
- `note` is one short clause on how/why the word changed at that stage.
- `meaning` is the word's meaning *at that stage*; `current_meaning` is today's
  meaning and shows in the badge on the map.
