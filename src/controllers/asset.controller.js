import Asset from '../models/asset.model.js'

export const getAssets = (req, res) => res.send('getAsset')
export const postAssets = async (req, res) => res.send('postAsset')
export const deleteAssets = (req, res) => res.send('deleteAsset')
export const putAssets = (req, res) => res.send('putAsset')