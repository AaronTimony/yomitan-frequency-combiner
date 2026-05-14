export function $(id) {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`Missing required element: #${id}`);
    return el;
}
