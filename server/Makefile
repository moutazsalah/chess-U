build-ApiFunction:
	cp -R dist package.json "$(ARTIFACTS_DIR)"
	cd "$(ARTIFACTS_DIR)" && npm pkg delete devDependencies && npm install --omit=dev
