# FW47: F1 Telemetry & AI Jira App v2
- **Goal:** Build a predictive ML pipeline and integrate it with Jira using Atlassian Forge LLMs.
- **Status:** Beginner-friendly, cost-optimized, learning-focused.
- A next step in development of the existing project. This file guides through learning phase of this project while building

## Phase 1: Data Pipeline & MongoDB
- [ ] Create a free MongoDB Atlas M0 cluster and get the connection string.
- [ ] Complete Kaggle "Pandas" micro-course.
- [ ] Write `extract.py` to fetch a 2024/2025 race using the `fastf1` Python library.
- [ ] Use Pandas to clean the data (handle `NaN` values, drop irrelevant columns).
- [ ] Write data to MongoDB Atlas using `pymongo`.

## Phase 2: Exploratory Data Analysis (EDA)
- [ ] Complete Kaggle "Data Visualization" micro-course.
- [ ] Install Jupyter Notebook (`pip install notebook`) and create `analysis.ipynb`.
- [ ] Fetch the cleaned data from MongoDB into the notebook.
- [ ] Plot Lap Times vs. Tire Temperatures using Matplotlib/Seaborn.
- [ ] Identify visual markers for pit stops or degradation trends.

## Phase 3: Machine Learning (Predictive Modeling)
- [ ] Watch "Machine Learning Fundamentals" and "XGBoost" by StatQuest (YouTube).
- [ ] Perform Feature Engineering: Calculate "rolling averages" for temperatures/speeds.
- [ ] Split data into Training (80%) and Testing (20%) sets.
- [ ] Train an XGBoost Classifier to predict a specific event (e.g., probability of a pit stop).
- [ ] Test the model and output a simple JSON alert when a threshold is met.

## Phase 4: Atlassian Forge & Generative AI
- [ ] Set up a basic Atlassian Forge app (`forge create`).
- [ ] Create a Forge Webtrigger that accepts a JSON payload from Python.
- [ ] Update the Forge Manifest (`manifest.yml`) to include the `llm` module.
- [ ] Use the Forge LLMs API (Claude) inside the Webtrigger to summarize the incoming telemetry alert.
- [ ] Configure the Webtrigger to automatically create a Jira Issue with the AI summary as the description.
- [ ] Write a final Python script (`trigger.py`) that runs the ML model and pushes the alert to the Forge Webtrigger.

## Phase 5: Documentation & Polish
- [ ] update the `README.md` explaining the changes made and the project.
