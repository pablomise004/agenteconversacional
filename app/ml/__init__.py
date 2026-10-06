"""Machine learning en Lince: datos en tabla (CSV) o imágenes, entrenamiento automático o personalizado,
modelos que se pueden probar y publicar. Todo con numpy y explicado paso a paso, como el NLU.

- table.py: leer un CSV, adivinar el tipo de cada columna y describirla.
- prep.py: convertir las filas en números (vacíos, categorías, fechas, escalado).
- algorithms.py: los algoritmos para tablas (lineal, logística, árbol, bosque, vecinos, Naive Bayes, k-medias).
- cnn.py: la red convolucional para imágenes (y las líneas base con píxeles).
- metrics.py: cómo se mide cada modelo (exactitud, R², silueta…) y qué columnas importan.
- runner.py: un entrenamiento completo: separar, preparar, probar algoritmos, elegir y explicar.
- codegen.py: el script equivalente en scikit-learn o PyTorch (para llevarlo a Azure o a tu ordenador).
- store.py: proyectos, datos, imágenes, entrenamientos y modelos en la carpeta de cada espacio.
- examples.py: los proyectos de ejemplo (pingüinos, bicis y formas).
- api.py: las rutas /api/ml/… de la API.
"""
