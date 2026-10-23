# Citi Bike Rebalancer

**Which bikes should I move, and where?** Pick a spot in Jersey City or Hoboken, and the app plans the moves that fix the most station imbalance per minute you travel.

### 👉 [Open the app: citi-bike-rebalancer.vercel.app](https://citi-bike-rebalancer.vercel.app)

Nothing to install. It works in any browser, on desktop or phone.

[![The app planning 10 moves from Grove St PATH](docs/img/plan.jpg)](https://citi-bike-rebalancer.vercel.app)

## How to use it

<table>
<tr>
<td width="33%" align="center"><img src="docs/img/search.jpg" alt="Search box with suggestions"><br><b>1. Say where you are</b><br>Search, use GPS, or tap the map</td>
<td width="33%" align="center"><img src="docs/img/mobile.jpg" alt="Planned route on a phone" width="70%"><br><b>2. Find best moves</b><br>Follow the numbered route</td>
<td width="33%" align="center"><img src="docs/img/station.jpg" alt="Station details sheet"><br><b>3. Tap any station</b><br>See its forecast and daily pattern</td>
</tr>
</table>

🔵 **Surplus**: too many bikes, pick one up  🔴 **Deficit**: too few, drop one off  ⚪ **Balanced**

## How it works

```mermaid
%%{init: {"theme": "neutral"}}%%
flowchart LR
    T[("106,617 trips<br>Sept 2026")] --> F["Forecast<br>bikes in / out per station"]
    F --> L{"Label<br>±3 bikes"}
    L -- surplus --> P["Planner<br>best move per minute"]
    L -- deficit --> P
    Y["Your location"] --> P
    P --> M["Map + step list"]
```

## The AI inside

![Each AI method, shown on the live app](docs/ai-methods-diagram.png)

| # | Method | Type |
|---|---|---|
| 1 | Location search | Classical NLP: alias table + TF-IDF |
| 2 | Demand forecast | Regression (historical average, gradient boosting) |
| 3 | Surplus / deficit labels | Threshold classification |
| 4 | Move planner | Greedy search |
| 5 | Station roles | k-means clustering |
| 6 | Hindsight check | Evaluation on held-out data |
| 7 | Plan explanations | Templates (no LLM) |
| 8 | LLM / RAG | Not used, on purpose |

## Results

```mermaid
%%{init: {"xyChart": {"width": 640, "height": 260}, "themeVariables": {"xyChart": {"plotColorPalette": "#276EF1"}}}}%%
xychart-beta
    title "Useful moves out of 300 (higher is better)"
    x-axis ["Value per minute (ours)", "Nearest first"]
    y-axis "Useful moves" 0 --> 300
    bar [272, 208]
```

```mermaid
%%{init: {"xyChart": {"width": 640, "height": 260}, "themeVariables": {"xyChart": {"plotColorPalette": "#8F8F8F"}}}}%%
xychart-beta
    title "Forecast error, 7-10 am (lower is better)"
    x-axis ["No change", "Average (default)", "Boosted", "Neural net"]
    y-axis "Mean abs. error (bikes)" 0 --> 5
    bar [4.81, 2.39, 2.32, 2.31]
```

## More screens

<table>
<tr>
<td width="50%"><img src="docs/img/activity.jpg" alt="Activity tab with charts and map playback"><br><b>Activity</b>: daily trips, hourly pattern, and a playback of the whole day</td>
<td width="50%"><img src="docs/img/evidence.jpg" alt="Evidence tab with result tables"><br><b>Evidence</b>: the numbers behind every design choice</td>
</tr>
</table>

## How it's hosted

```mermaid
%%{init: {"theme": "neutral"}}%%
flowchart LR
    G["Push to main<br>on GitHub"] --> V["Vercel builds<br>automatically"]
    V --> W["Map + charts<br>(static site)"]
    V --> A["/api/*<br>(Python function)"]
    W --> L(["citi-bike-rebalancer.vercel.app"])
    A --> L
```

The app is hosted on Vercel and redeploys itself on every push to `main`. The API is a small Python function that reads a pre-built data file (`backend/app/runtime_data/runtime.json.gz`), so the live site needs no database and no setup.

<details>
<summary><b>For developers: rebuild the data or run it on your own machine</b></summary>

Needs Python 3.11+, [uv](https://docs.astral.sh/uv/) and Node 20+. Put the [trip data](https://s3.amazonaws.com/tripdata/index.html) at `data/JC-202609-citibike-tripdata.csv`.

```bash
make setup
```

```bash
make data
```

```bash
make dev
```

`make data` rebuilds the data file; commit it and push to update the live site. `make dev` runs a local copy at http://localhost:5173. No `make`? Use `python tasks.py setup`, `data` and `dev`.

</details>

## Good to know

- Sept 26–28 had a big, unexplained drop in riders. The app shows it rather than hiding it.
- Street paths come from the public OSRM server, which uses car routing. Planning uses straight-line distance.
- Van mode is new and untested. No API keys, no paid services, no LLM calls.
