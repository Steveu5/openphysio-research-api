// Notice shown when the model could not produce the expected answer and a
// fallback (the retrieved sources to review) is returned instead.
function degradedNotice(language = "es", charged = false) {
  if (language === "en") {
    return charged
      ? "**The full answer could not be generated.** The sources retrieved for your question are listed below."
      : "**The full answer could not be generated.** The sources retrieved for your question are listed below. This query was not counted against your plan; you can try again.";
  }
  return charged
    ? "**No se pudo generar la respuesta completa.** Abajo tienes las fuentes recuperadas para tu pregunta."
    : "**No se pudo generar la respuesta completa.** Abajo tienes las fuentes recuperadas para tu pregunta. Esta consulta no se ha descontado de tu plan; puedes intentarlo de nuevo.";
}

module.exports = { degradedNotice };
