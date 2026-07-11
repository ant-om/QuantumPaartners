"""
Write a function called 'main' that accepts one list as an argument. The list 
consists of sublists, in which the first element is a string and the other
6 elements are integers. 

Your function should return a dictionary, where the keys are the strings from 
every sublist and the values are sub-dictionaries. 

The values of the sub-dictionaries are the integers of the sublists. 
The keys of the sub-dictionaries are strings from the following list (in this 
order): ['cat 4', 'cat 6', 'cat 7', 'cat 1', 'cat 2', 'cat 3']

Hint: Try to solve this problem with a dictionary comprehension inside another 
dictionary comprehension. Alternatively, build the outside dictionary with a
for-loop, and the sub-dictionaries inside with a dict comprehension.

For example:
If we are calling your function as:
main([['Sandia', 72, 71, 68, 77, 55, 66], ['Anaitha', 80, 53, 68, 51, 53, 53], ['Chitrashi', 56, 68, 71, 80, 56, 55], ['Arya', 58, 63, 57, 51, 55, 58]]) 
then it should return the dictionary: 
{'Sandia': {'cat 4': 72, 'cat 6': 71, 'cat 7': 68, 'cat 1': 77, 'cat 2': 55, 'cat 3': 66}, 
 'Anaitha': {'cat 4': 80, 'cat 6': 53, 'cat 7': 68, 'cat 1': 51, 'cat 2': 53, 'cat 3': 53}, 
 'Chitrashi': {'cat 4': 56, 'cat 6': 68, 'cat 7': 71, 'cat 1': 80, 'cat 2': 56, 'cat 3': 55}, 
 'Arya': {'cat 4': 58, 'cat 6': 63, 'cat 7': 57, 'cat 1': 51, 'cat 2': 55, 'cat 3': 58}}
"""
def main(l1):
    b = ['cat 4', 'cat 6', 'cat 7', 'cat 1', 'cat 2', 'cat 3']
    d1 = {i[0]:{k:v for k,v in zip(b,i[1:])} for i in l1}
    return d1

#loops through l1 with i and then bcs you have another dictionary comprehension inside of it, it still loops through it
