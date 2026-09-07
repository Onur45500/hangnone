import subprocess

def run_agent():
    subprocess.run(["claude", "-p", "Summarize status"], check=False)
