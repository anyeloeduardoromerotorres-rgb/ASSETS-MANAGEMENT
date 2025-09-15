// controllers/configInfo.controller.js
import ConfigInfo from "../models/configInfo.model.js";

// ✅ Obtener todas las configuraciones
export async function getAllConfigInfo(req, res) {
  try {
    const configs = await ConfigInfo.find();
    res.json(configs);
  } catch (error) {
    console.error("❌ Error obteniendo ConfigInfo:", error.message);
    res.status(500).json({ error: "No se pudo obtener la configuración" });
  }
}

// ✅ Obtener una configuración por ID
export async function getConfigInfoById(req, res) {
  try {
    const { id } = req.params;
    const config = await ConfigInfo.findById(id);
    if (!config) return res.status(404).json({ error: "ConfigInfo no encontrada" });
    res.json(config);
  } catch (error) {
    console.error("❌ Error obteniendo ConfigInfo:", error.message);
    res.status(500).json({ error: "No se pudo obtener la configuración" });
  }
}

// ✅ Obtener configuración por name
export async function getConfigInfoByName(req, res) {
  try {
    const { name } = req.params;
    const config = await ConfigInfo.findOne({ name });
    if (!config) return res.status(404).json({ error: "ConfigInfo no encontrada" });
    res.json(config);
  } catch (error) {
    console.error("❌ Error obteniendo ConfigInfo por nombre:", error.message);
    res.status(500).json({ error: "No se pudo obtener la configuración" });
  }
}


// ✅ Crear nueva configuración
export async function createConfigInfo(req, res) {
  try {
    const { name, description, total } = req.body;
    const newConfig = await ConfigInfo.create({ name, description, total });
    res.status(201).json(newConfig);
  } catch (error) {
    console.error("❌ Error creando ConfigInfo:", error.message);
    res.status(500).json({ error: "No se pudo crear la configuración" });
  }
}

// ✅ Actualizar configuración
export async function updateConfigInfo(req, res) {
  try {
    const { id } = req.params;
    const updatedConfig = await ConfigInfo.findByIdAndUpdate(id, req.body, {
      new: true,
    });
    if (!updatedConfig) return res.status(404).json({ error: "ConfigInfo no encontrada" });
    res.json(updatedConfig);
  } catch (error) {
    console.error("❌ Error actualizando ConfigInfo:", error.message);
    res.status(500).json({ error: "No se pudo actualizar la configuración" });
  }
}

// ✅ Eliminar configuración
export async function deleteConfigInfo(req, res) {
  try {
    const { id } = req.params;
    const deleted = await ConfigInfo.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "ConfigInfo no encontrada" });
    res.json({ message: "ConfigInfo eliminada correctamente" });
  } catch (error) {
    console.error("❌ Error eliminando ConfigInfo:", error.message);
    res.status(500).json({ error: "No se pudo eliminar la configuración" });
  }
}
