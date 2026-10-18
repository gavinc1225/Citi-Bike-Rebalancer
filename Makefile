# Same commands as `python tasks.py <target>` (use that on Windows without make).
.PHONY: setup data dev test

setup:
	python tasks.py setup

data:
	python tasks.py data

dev:
	python tasks.py dev

test:
	python tasks.py test
