import Exchange from '../models/exchange.model.js'

export const getExchange = (req, res) => res.send('getExchange')
export const postExchange = async (req, res) => {

    const {name, apiURL} = req.body
    
    let exchange = new Exchange({
        name,
        apiURL
    })

    try {
        await exchange.save()
        res.send('registrado')
        
    } catch (error) {
        console.log(error);
    }


    
}
export const deleteExchange = (req, res) => res.send('deleteExchange')
export const putExchange = (req, res) => res.send('putExchange')