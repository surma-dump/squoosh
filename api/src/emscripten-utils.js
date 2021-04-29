export function pathify(path) {
  return `/squoosh/${path}`;
}

export function instantiateEmscriptenWasm(factory, path) {
  return factory({
    locateFile() {
      return pathify(path);
    },
  });
}
