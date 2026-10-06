"""El script de Python que hace lo mismo que un modelo de Lince, con las librerías de siempre.

Para las tablas, scikit-learn (y pandas); para las imágenes, PyTorch. Sirve para ver el entrenamiento
escrito como código y para llevarlo a Azure ML («Trabajos → Script de entrenamiento personalizado») o a tu
ordenador. Los ajustes son los mismos que se usaron en Lince; los resultados salen muy parecidos (no
idénticos: cada librería tiene sus detalles, como el orden aleatorio o cómo para el descenso por gradiente).
"""

from __future__ import annotations

import json
import textwrap


def _py(v) -> str:
    return json.dumps(v, ensure_ascii=False)


def _list(items: list[str]) -> str:
    if not items:
        return "[]"
    return "[" + ", ".join(_py(i) for i in items) + "]"


def _assign(name: str, call: str, width: int = 100) -> list[str]:
    """`name = call` en una línea o, si no cabe, con los argumentos en la siguiente (en la consola no hay que
    desplazarse a un lado para leerla)."""
    line = f"{name} = {call}"
    if len(line) <= width or "(" not in call or not call.endswith(")"):
        return [line]
    head, _, args = call.partition("(")
    return [f"{name} = {head}(", f"    {args[:-1]})"]


def _steps(name: str, call: str, items: list[str]) -> list[str]:
    """`name = call([a, b, c])` con un elemento por línea (y su comentario, si lo trae: «código  # …»)."""
    lines = []
    for item in items:
        code, sep, note = item.partition("  # ")
        lines.append(f"    {code}," + (f"  # {note}" if sep else ""))
    return [f"{name} = {call}(["] + lines + ["])"]


def table_script(report: dict, config: dict, filename: str) -> str:
    task = report["task"]
    key, params = report["algorithm"], report.get("params") or {}
    feats = report.get("features") or []
    nums = [f["name"] for f in feats if f["kind"] == "number"]
    cats = [f["name"] for f in feats if f["kind"] == "category"]
    dates = [f["name"] for f in feats if f["kind"] == "date"]
    seed = config.get("seed", 42)
    test = config.get("testSize", 0.2)
    folds = config.get("folds", 5)
    rows = (report.get("rows") or {}).get("train", 100)
    cls = task == "classification"
    if key == "kmeans" and not params.get("k"):  # en automático se guardaba k = 0 («que lo elija»): la que eligió
        params = dict(params, k=(report.get("metrics") or {}).get("k") or 3)
    imports, estimator, note = algorithm_code(key, params, task, rows)
    L = [
        f"# Script equivalente al modelo «{report['name']}» de Lince.",
        "# Hace lo mismo con scikit-learn, la librería de machine learning más usada en Python, para tu",
        "# ordenador o para Azure ML (Trabajos → Script de entrenamiento personalizado).",
        "# Necesita: pip install pandas scikit-learn",
    ]
    if note:
        L += ["# " + line for line in textwrap.wrap("Nota: " + note, 98)]
    L += ["", "import pandas as pd",
          "from sklearn.compose import ColumnTransformer",
          "from sklearn.impute import SimpleImputer",
          "from sklearn.pipeline import Pipeline",
          "from sklearn.preprocessing import OneHotEncoder, StandardScaler"]
    if task == "clustering":
        L += ["from sklearn.metrics import silhouette_score"]
    else:
        L += ["from sklearn.model_selection import " + ("StratifiedKFold" if cls else "KFold") + ", cross_val_score, train_test_split"]
        L += ["from sklearn.metrics import " + ("accuracy_score, classification_report, confusion_matrix" if cls
                                                 else "mean_absolute_error, mean_squared_error, r2_score")]
    L += imports
    L += ["", f"datos = pd.read_csv({_py(filename)})  # la tabla: en Lince, página Datos → Descargar CSV"]
    if task != "clustering":
        L += [f"objetivo = {_py(report['target'])}", "datos = datos.dropna(subset=[objetivo])"]
    L += [f"numericas = {_list(nums)}", f"categoricas = {_list(cats)}"]
    if dates:
        L += [f"fechas = {_list(dates)}", "",
              "# Las fechas se parten en año, mes y día de la semana (como en Lince)",
              "for col in fechas:",
              "    f = pd.to_datetime(datos[col], dayfirst=True)",
              "    for parte, valor in ((\"año\", f.dt.year), (\"mes\", f.dt.month), (\"día de la semana\", f.dt.weekday)):",
              "        datos[f\"{col} · {parte}\"] = valor",
              "        numericas.append(f\"{col} · {parte}\")"]
    L += ["for col in categoricas:",
          "    datos[col] = datos[col].astype(\"string\")",
          "",
          "# Preparar: vacíos con la mediana (números) o «(vacío)» (categorías), categorías → 0/1, números escalados",
          "preparar = ColumnTransformer([",
          "    (\"numeros\", Pipeline([(\"rellenar\", SimpleImputer(strategy=\"median\")), (\"escalar\", StandardScaler())]), numericas),",
          "    (\"categorias\", Pipeline([(\"rellenar\", SimpleImputer(strategy=\"constant\", fill_value=\"(vacío)\")),",
          "                              (\"one_hot\", OneHotEncoder(handle_unknown=\"ignore\", max_categories=31))]), categoricas),",
          "])",
          *_assign("algoritmo", estimator),
          "modelo = Pipeline([(\"preparar\", preparar), (\"algoritmo\", algoritmo)])",
          "X = datos[numericas + categoricas]"]
    if task == "clustering":
        L += ["", "grupos = modelo.fit_predict(X)",
              "print(\"Filas en cada grupo:\", pd.Series(grupos + 1).value_counts().sort_index().to_dict())",
              "print(\"Silueta:\", silhouette_score(modelo[\"preparar\"].transform(X), grupos))"]
        return "\n".join(L) + "\n"
    L += ["y = datos[objetivo]" + (".astype(str)" if cls else ""), "",
          f"# Separar: un {round(test * 100)} % escondido para el examen final" + (" (por estratos)" if cls else ""),
          f"X_ent, X_exa, y_ent, y_exa = train_test_split(X, y, test_size={test}, random_state={seed}"
          + (", stratify=y)" if cls else ")")]
    metric = report.get("metric", "accuracy" if cls else "r2")
    scoring = {"accuracy": "accuracy", "balanced_accuracy": "balanced_accuracy", "f1_macro": "f1_macro",
               "r2": "r2", "rmse": "neg_root_mean_squared_error", "mae": "neg_mean_absolute_error"}.get(metric, "accuracy")
    if folds:
        L += ["", f"# Validación cruzada de {folds} rondas con las filas de entrenamiento",
              f"rondas = {'StratifiedKFold' if cls else 'KFold'}({folds}, shuffle=True, random_state={seed})",
              f"notas = cross_val_score(modelo, X_ent, y_ent, cv=rondas, scoring={_py(scoring)})",
              "print(\"Validación cruzada:\", notas.mean().round(3), \"±\", notas.std().round(3))"]
    L += ["", "# Entrenar con todo el entrenamiento y examinar", "modelo.fit(X_ent, y_ent)", "pred = modelo.predict(X_exa)"]
    if cls:
        L += ["print(\"Exactitud en el examen:\", round(accuracy_score(y_exa, pred), 3))",
              "print(confusion_matrix(y_exa, pred))",
              "print(classification_report(y_exa, pred))",
              "", "# En Azure ML, para ver la métrica en el trabajo:",
              "# import mlflow", "# mlflow.log_metric(\"exactitud\", accuracy_score(y_exa, pred))"]
    else:
        L += ["print(\"R²:\", round(r2_score(y_exa, pred), 3))",
              "print(\"RMSE:\", round(mean_squared_error(y_exa, pred) ** 0.5, 3))",
              "print(\"MAE:\", round(mean_absolute_error(y_exa, pred), 3))",
              "", "# En Azure ML, para ver la métrica en el trabajo:",
              "# import mlflow", "# mlflow.log_metric(\"r2\", r2_score(y_exa, pred))"]
    return "\n".join(L) + "\n"


def algorithm_code(key: str, params: dict, task: str, rows: int) -> tuple[list[str], str, str]:
    cls = task == "classification"
    if key == "baseline":
        return ([f"from sklearn.dummy import {'DummyClassifier' if cls else 'DummyRegressor'}"],
                "DummyClassifier(strategy=\"most_frequent\")" if cls else "DummyRegressor(strategy=\"mean\")", "")
    if key == "linear":
        l2 = float(params.get("l2", 0) or 0)
        if l2 > 0:
            return ["from sklearn.linear_model import Ridge"], f"Ridge(alpha={l2 * rows:g})", ""
        return ["from sklearn.linear_model import LinearRegression"], "LinearRegression()", ""
    if key == "logistic":
        l2 = float(params.get("l2", 0.001) or 0)
        c = 1 / (l2 * rows) if l2 > 0 else 1e6
        return (["from sklearn.linear_model import LogisticRegression"], f"LogisticRegression(C={c:.4g}, max_iter=1000)",
                "en scikit-learn la regularización se da al revés: C = 1 / (regularización × filas). Lince usa "
                "descenso por gradiente con un número fijo de vueltas; scikit-learn sigue hasta converger.")
    if key == "tree":
        extra = f", criterion={_py(params.get('criterion', 'gini'))}" if cls else ""
        name = "DecisionTreeClassifier" if cls else "DecisionTreeRegressor"
        return ([f"from sklearn.tree import {name}"],
                f"{name}(max_depth={params.get('max_depth', 5)}, min_samples_leaf={params.get('min_leaf', 2)}{extra}, random_state=0)", "")
    if key == "forest":
        mf = {"sqrt": "\"sqrt\"", "third": "0.33", "all": "None"}.get(params.get("max_features", "sqrt"), "\"sqrt\"")
        name = "RandomForestClassifier" if cls else "RandomForestRegressor"
        return ([f"from sklearn.ensemble import {name}"],
                f"{name}(n_estimators={params.get('n_trees', 50)}, max_depth={params.get('max_depth', 10)}, "
                f"min_samples_leaf={params.get('min_leaf', 1)}, max_features={mf}, random_state=7)", "")
    if key == "knn":
        name = "KNeighborsClassifier" if cls else "KNeighborsRegressor"
        return ([f"from sklearn.neighbors import {name}"],
                f"{name}(n_neighbors={params.get('k', 5)}, weights={_py(params.get('weights', 'uniform'))})", "")
    if key == "bayes":
        return (["from sklearn.naive_bayes import GaussianNB"], "GaussianNB()",
                "Lince trata las categorías con sus frecuencias (Naive Bayes categórico) y los números con una campana "
                "de Gauss; GaussianNB lo aproxima tratando también las columnas de 0/1 como números.")
    if key == "kmeans":
        k = params.get("k") or 3
        return (["from sklearn.cluster import KMeans"], f"KMeans(n_clusters={k}, n_init={params.get('n_init', 5)}, random_state=3)",
                "")
    raise ValueError(key)


def images_script(report: dict, config: dict) -> str:
    key, params = report["algorithm"], report.get("params") or {}
    classes = report.get("classes") or []
    test = config.get("testSize", 0.2)
    seed = config.get("seed", 42)
    head = [f"# Script equivalente al modelo «{report['name']}» de Lince.",
            "# Las imágenes: en Lince, página Datos → Descargar las imágenes (un ZIP con una carpeta por clase).",
            f"# Clases: {', '.join(classes)}"]
    if key != "cnn":
        model = ("LogisticRegression(max_iter=300)" if key == "pixels_logistic"
                 else f"KNeighborsClassifier(n_neighbors={params.get('k', 3)})")
        imp = ("from sklearn.linear_model import LogisticRegression" if key == "pixels_logistic"
               else "from sklearn.neighbors import KNeighborsClassifier")
        return "\n".join(head + [
            "# Necesita: pip install numpy pillow scikit-learn", "",
            "from pathlib import Path", "import numpy as np", "from PIL import Image", imp,
            "from sklearn.model_selection import train_test_split", "from sklearn.preprocessing import StandardScaler",
            "from sklearn.metrics import accuracy_score, confusion_matrix", "",
            "X, y = [], []",
            "for carpeta in sorted(Path(\"imagenes\").iterdir()):",
            "    for f in carpeta.glob(\"*.png\"):",
            "        img = Image.open(f).convert(\"RGB\").resize((16, 16), Image.BOX)  # cada píxel es una columna",
            "        X.append(np.asarray(img, dtype=float).ravel() / 255)",
            "        y.append(carpeta.name)",
            "X, y = np.array(X), np.array(y)",
            f"X_ent, X_exa, y_ent, y_exa = train_test_split(X, y, test_size={test}, random_state={seed}, stratify=y)",
            "escalar = StandardScaler().fit(X_ent)",
            f"modelo = {model}.fit(escalar.transform(X_ent), y_ent)",
            "pred = modelo.predict(escalar.transform(X_exa))",
            "print(\"Exactitud en el examen:\", round(accuracy_score(y_exa, pred), 3))",
            "print(confusion_matrix(y_exa, pred))"]) + "\n"
    size = int(params.get("size", 32))
    gray = params.get("color") == "gris"
    ch = 1 if gray else 3
    flip = params.get("augment", "si")
    aug = []
    if flip != "no":
        aug.append("transforms.RandomAffine(degrees=0, translate=(0.1, 0.1))  # mover un poco")
        if flip == "si":
            aug.append("transforms.RandomHorizontalFlip()  # voltear")
        aug.append("transforms.ColorJitter(brightness=0.15)  # cambiar el brillo")
    gray_line = ["transforms.Grayscale()  # solo la forma: en gris"] if gray else []
    base = [f"transforms.Resize(({size}, {size}))", *gray_line, "transforms.ToTensor()", "Normalizar()"]
    return "\n".join(head + [
        "# Necesita: pip install torch torchvision", "",
        "import torch", "from torch import nn", "from torch.utils.data import DataLoader, random_split",
        "from torchvision import datasets, transforms", "",
        f"torch.manual_seed({seed})", "",
        "class Normalizar:",
        "    \"\"\"Cada imagen con media 0 y desviación 1, como en Lince.\"\"\"",
        "    def __call__(self, x):",
        "        return (x - x.mean()) / (x.std() + 1e-6)", "",
        *_steps("entrenar_tf", "transforms.Compose", aug + base),
        *_steps("examen_tf", "transforms.Compose", base),
        "todas = datasets.ImageFolder(\"imagenes\")",
        f"n_exa = int(len(todas) * {test})",
        "ent, exa = random_split(todas, [len(todas) - n_exa, n_exa])",
        "ent.dataset = datasets.ImageFolder(\"imagenes\", transform=entrenar_tf)",
        "exa = torch.utils.data.Subset(datasets.ImageFolder(\"imagenes\", transform=examen_tf), exa.indices)",
        "", "red = nn.Sequential(",
        f"    nn.Conv2d({ch}, 8, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),",
        "    nn.Conv2d(8, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),",
        "    nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),",
        "    nn.AdaptiveMaxPool2d(1), nn.Flatten(),  # global max pooling",
        f"    nn.Linear(32, {len(classes)}),", ")",
        f"optimizador = torch.optim.Adam(red.parameters(), lr={params.get('lr', 0.003)})",
        "error = nn.CrossEntropyLoss()", "",
        f"for epoca in range({params.get('epochs', 30)}):",
        "    red.train()",
        "    for x, y in DataLoader(ent, batch_size=32, shuffle=True):",
        "        optimizador.zero_grad()",
        "        perdida = error(red(x), y)",
        "        perdida.backward()  # retropropagación",
        "        optimizador.step()",
        "    red.eval()",
        "    with torch.no_grad():",
        "        aciertos = sum((red(x).argmax(1) == y).sum().item() for x, y in DataLoader(exa, batch_size=128))",
        "    print(f\"vuelta {epoca + 1}: acierta el {aciertos / len(exa):.0%} del examen\")"]) + "\n"
