Algorithmic Taxonomy of Chess Playing Styles: Vector-Space Framework, Metric Restructuring, and Empirical Calibration EngineThis document provides a comprehensive technical architecture and mathematical specification for calculating, normalizing, and scoring 9 distinct chess personality traits based on game telemetry extracted from standard PGN feeds and Stockfish engine evaluations.1. System Pipeline & Architectural WorkflowThe archetype identification engine operates in a four-stage pipeline:[ Raw Game Data (PGN/Clock) ]
           │
           ▼
[ Stage 1: Feature Extraction (stats.py & style_metrics.py) ]
           │
           ▼
[ Stage 2: Contextual Normalization (Elo & Time Control Calibration) ]
           │
           ▼
[ Stage 3: Secondary Group Aggregation & Metric Restructuring ]
           │
           ▼
[ Stage 4: High-Dimensional Similarity & 0-100 Archetype Scoring ]
2. Technical Definitions for the 9 ArchetypesEach archetype represents an ideal benchmark vector in a continuous feature space. The table below outlines the core signature criteria for each trait:ArchetypeOpening SelectionOpening OrthodoxyTactical / Strategic PreferenceTime Management ProfileTechnicalSame OpeningsOrthodoxManeuver StyleDisadvantage Time: BadPositionalDifferent OpeningsOrthodoxManeuver StyleDisadvantage Time: BadAttackingSame OpeningsOrthodoxInitiative StyleCritical Time: GoodCalculatingSame OpeningsOrthodoxAverage / CalculationOverall Time Usage: BadTrickyDifferent OpeningsUnorthodoxInitiative StyleDisadvantage & Critical Time: GoodDynamicSame OpeningsUnorthodoxInitiative + Maneuver MixDisadvantage & Critical Time: GoodPracticalDifferent OpeningsOrthodoxFlexibleOverall Time Usage: GoodIntuitiveFlexibleFlexiblePure Maneuver StyleAll Time Usage: GoodLogicalDifferent OpeningsOrthodoxManeuver + Initiative MixOverall Time Usage: Good3. Metric Restructuring & Mathematical FormulationsTo convert raw telemetry into bounded features, raw engine and PGN outputs are mapped to normalized sub-metrics $m_k \in [0, 1]$.3.1 Maneuver Index ($M_{\text{maneuver}}$) vs. Initiative Index ($M_{\text{init}}$)Maneuver Style ($M_{\text{maneuver}}$): Characterized by low evaluation volatility ($\sigma_{\text{eval}}$), low sacrifice rate ($R_{\text{sac}}$), high endgame conversion ($C_{\text{eg}}$), and frequent early piece trades ($R_{\text{trade}}$).$$M_{\text{maneuver}} = w_1 \cdot \left(1 - f_{\text{norm}}(\sigma_{\text{eval}})\right) + w_2 \cdot \left(1 - f_{\text{norm}}(R_{\text{sac}})\right) + w_3 \cdot C_{\text{eg}} + w_4 \cdot R_{\text{trade}}$$Initiative Style ($M_{\text{init}}$): Characterized by high evaluation volatility, high sacrifice rate, and early flank pawn pushes in enemy territory ($R_{\text{flank}}$).$$M_{\text{init}} = w_1 \cdot f_{\text{norm}}(\sigma_{\text{eval}}) + w_2 \cdot f_{\text{norm}}(R_{\text{sac}}) + w_3 \cdot R_{\text{flank}}$$3.2 Intuitive Style Index ($M_{\text{intuitive}}$)Intuitive play is operationalized as high evaluation volatility, high sacrifice rate, high opposite-territory dominance ($T_{\text{opp}}$), and early flank pawn advances:$$M_{\text{intuitive}} = 0.30 \cdot f_{\text{norm}}(\sigma_{\text{eval}}) + 0.25 \cdot f_{\text{norm}}(R_{\text{sac}}) + 0.25 \cdot T_{\text{opp}} + 0.20 \cdot R_{\text{flank}}$$4. Secondary Influencing GroupsFive secondary thematic groups act as modifiers across the traits:Creativity ($G_{\text{creat}}$): Drawishless rate, declined recapture rate, and critical position time allocation.Attacking ($G_{\text{att}}$): Higher-value threats, trades near enemy king, forward move ratio, and territory dominance.Positioning ($G_{\text{pos}}$): Structure closedness/semi-closedness share, low pawn mobility frequency, and piece equality balance.Defense ($G_{\text{def}}$): Threat escape efficiency, trades near own king, and low blunder rate.Durability ($G_{\text{dur}}$): Disadvantage recovery rate, clock differential maintenance, and blunder resilience.Metric Influence MatrixSecondary GroupInfluenced Personality TraitsWeight (β)CreativityAttacking, Tricky, Dynamic, Practical, Intuitive, Logical$0.15$AttackingAttacking, Tricky, Dynamic$0.20$PositioningTechnical, Positional, Calculating, Practical, Intuitive, Logical$0.20$DefenseTechnical, Positional, Calculating, Logical$0.15$DurabilityTricky, Dynamic, Practical, Intuitive$0.15$5. Elo & Time Control Baseline CalibrationRaw behavioral metrics change significantly based on skill level and available time. A 1200 Elo player taking 8 seconds per move in Blitz is fast, whereas a 2200 Elo player taking 8 seconds per move in Classical is extremely fast.5.1 Partitioned Population Sub-DomainsWe establish empirical reference tables across 6 Elo rating bands ($E_1 \dots E_6$) and 4 Time Control tiers ($C_1 \dots C_4$):Elo Bands ($E$): $E_1 (<1200)$, $E_2 (1200-1499)$, $E_3 (1500-1799)$, $E_4 (1800-2099)$, $E_5 (2100-2399)$, $E_6 (\ge 2400)$Time Controls ($C$): Bullet ($C_1$), Blitz ($C_2$), Rapid ($C_3$), Classical ($C_4$)5.2 Dual-Parameter Z-Score NormalizationFor any raw metric $x$ collected in a game under Elo band $E_i$ and time control $C_j$:$$z = \frac{x - \mu(E_i, C_j)}{\sigma(E_i, C_j)}$$The Z-score is then mapped to standard bounded interval $[0, 1]$ via the logistic sigmoid transformation function:$$f_{\text{norm}}(x) = \frac{1}{1 + e^{-z}}$$Baseline Reference Parameter Sample Table ($\mu \pm \sigma$)Metric (x)Elo Band (E)Time Control (C)Baseline Mean (μ)Std Dev (σ)Avg Time / Move$E_2 (1200-1499)$Rapid ($C_3$)$18.5 \text{ s}$$4.2 \text{ s}$Avg Time / Move$E_5 (2100-2399)$Rapid ($C_3$)$14.2 \text{ s}$$3.1 \text{ s}$Eval Volatility$E_3 (1500-1799)$Blitz ($C_2$)$85.0 \text{ cp}$$22.5 \text{ cp}$Disadvantage Think Time$E_4 (1800-2099)$Rapid ($C_3$)$12.4 \text{ s}$$3.8 \text{ s}$6. Mathematical Vector Similarity & Score CalculationLet $\vec{P} = [p_1, p_2, \dots, p_K]^T$ be the normalized feature vector extracted from the user's games, and let $\vec{T}_a = [t_{a,1}, t_{a,2}, \dots, t_{a,K}]^T$ be the target archetype specification vector for trait $a \in \{1, \dots, 9\}$.6.1 Distance and Directional MetricsWeighted Cosine Similarity ($S_{\text{cos}}$): Measures alignment in directional tendency:$$S_{\text{cos}}(\vec{P}, \vec{T}_a) = \frac{\sum_{k=1}^{K} w_k \cdot p_k \cdot t_{a,k}}{\sqrt{\sum_{k=1}^{K} w_k \cdot p_k^2} \sqrt{\sum_{k=1}^{K} w_k \cdot t_{a,k}^2}}$$Normalized Euclidean Distance ($D_{\text{euc}}$): Measures absolute magnitude divergence:$$D_{\text{euc}}(\vec{P}, \vec{T}_a) = \sqrt{\sum_{k=1}^{K} w_k \cdot (p_k - t_{a,k})^2}$$6.2 Hybrid Match Score Formulation (0-100 Scale)The ultimate match score $Score_a \in [0, 100]$ combines directional alignment and spatial closeness, plus secondary group bonus score $\Delta G_a$:$$Match_a = \alpha \cdot S_{\text{cos}}(\vec{P}, \vec{T}_a) + (1 - \alpha) \cdot \left(1 - \frac{D_{\text{euc}}(\vec{P}, \vec{T}_a)}{\sqrt{\sum w_k}}\right)$$$$Score_a = \min\left(100, \max\left(0, 100 \cdot Match_a + \beta \cdot \Delta G_a\right)\right)$$where $\alpha = 0.60$ and $\beta = 0.15$.7. Python Engine Core Reference ModuleThe following Python module (archetype_engine.py) integrates directly with your existing dataset structures:import numpy as np
import pandas as pd

# Calibration tables for Baseline Normalization (Mean, StdDev)
BASELINE_TABLES = {
    "blitz": {
        "1500-1799": {
            "avg_time_per_move": (8.2, 2.1),
            "eval_volatility": (85.0, 22.5),
            "disadvantage_time": (7.5, 2.8),
            "critical_time": (11.2, 4.0),
        }
    }
}

ARCHETYPE_BENCHMARKS = {
    "Technical": {
        "same_openings": 1.0,
        "orthodox": 1.0,
        "maneuver_style": 1.0,
        "disadvantage_time_quality": 0.0,
    },
    "Positional": {
        "same_openings": 0.0,
        "orthodox": 1.0,
        "maneuver_style": 1.0,
        "disadvantage_time_quality": 0.0,
    },
    "Attacking": {
        "same_openings": 1.0,
        "orthodox": 1.0,
        "initiative_style": 1.0,
        "critical_time_quality": 1.0,
    },
    "Calculating": {
        "same_openings": 1.0,
        "orthodox": 1.0,
        "overall_time_quality": 0.0,
    },
    "Tricky": {
        "same_openings": 0.0,
        "orthodox": 0.0,
        "initiative_style": 1.0,
        "disadvantage_time_quality": 1.0,
        "critical_time_quality": 1.0,
    },
    "Dynamic": {
        "same_openings": 1.0,
        "orthodox": 0.0,
        "initiative_style": 0.7,
        "maneuver_style": 0.5,
        "disadvantage_time_quality": 1.0,
        "critical_time_quality": 1.0,
    },
    "Practical": {
        "same_openings": 0.0,
        "orthodox": 1.0,
        "overall_time_quality": 1.0,
    },
    "Intuitive": {
        "maneuver_style": 1.0,
        "intuitive_style": 1.0,
        "overall_time_quality": 1.0,
    },
    "Logical": {
        "same_openings": 0.0,
        "orthodox": 1.0,
        "maneuver_style": 0.6,
        "initiative_style": 0.4,
        "overall_time_quality": 1.0,
    },
}

def sigmoid(z: float) -> float:
    return 1.0 / (1.0 + np.exp(-z))

def normalize_metric(value: float, mean: float, std: float) -> float:
    if std == 0:
        return 0.5
    z = (value - mean) / std
    return sigmoid(z)

def calculate_archetype_scores(user_vector: dict, secondary_groups: dict) -> dict:
    scores = {}
    for name, benchmark in ARCHETYPE_BENCHMARKS.items():
        keys = list(benchmark.keys())
        p_vec = np.array([user_vector.get(k, 0.5) for k in keys])
        t_vec = np.array([benchmark[k] for k in keys])
        
        # Cosine similarity
        dot = np.dot(p_vec, t_vec)
        norm_p = np.linalg.norm(p_vec)
        norm_t = np.linalg.norm(t_vec)
        cos_sim = dot / (norm_p * norm_t) if norm_p > 0 and norm_t > 0 else 0.0
        
        # Euclidean closeness
        euc_dist = np.linalg.norm(p_vec - t_vec)
        euc_close = max(0.0, 1.0 - (euc_dist / np.sqrt(len(keys))))
        
        # Hybrid match score
        match_pct = (0.60 * cos_sim + 0.40 * euc_close) * 100.0
        
        # Secondary modifier application
        mod = secondary_groups.get(name, 0.0) * 10.0
        final_score = min(100.0, max(0.0, match_pct + mod))
        scores[name] = round(final_score, 1)
        
    return scores
