.PHONY: setup render validate preview clean

setup:
	python3 pipeline.py setup

render:
	python3 pipeline.py render

validate:
	python3 pipeline.py validate

preview:
	python3 pipeline.py preview

clean:
	@echo "Generated files are in dist/. Remove that folder when you no longer need them."

