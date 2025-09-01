import Depositewithdrawal from '../models/depositewithdrawal.model.js'

export const getDepositeWithdrawal = (req, res) => res.send('getDeposite')
export const postDepositeWithdrawal = async (req, res) => {

    const {transaction, quantity} = req.body
    
    let deposite = new Depositewithdrawal({
        transaction,
        quantity
    })

    try {
        await deposite.save()
        res.send('registrado')
        
    } catch (error) {
        console.log(error);
    }


    
}
export const deleteDepositeWithdrawal = (req, res) => res.send('deleteDeposite')
export const putDepositeWithdrawal = (req, res) => res.send('putDeposite')

