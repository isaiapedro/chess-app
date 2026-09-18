from baselines import baselines_payload, load_baselines


def baselines_response() -> dict:
    return baselines_payload(load_baselines())
