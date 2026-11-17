export function success<T>(data: T) {
  return { success: true, data };
}

export function paginated<T, M>(data: T, meta: M) {
  return { success: true, data, meta };
}
